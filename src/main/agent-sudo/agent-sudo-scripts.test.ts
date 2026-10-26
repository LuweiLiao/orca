import { execFile, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startAgentSudoAskpassServer,
  type AgentSudoAskpassRequest
} from './agent-sudo-askpass-server'
import {
  AGENT_SUDO_ENDPOINT_ENV,
  renderAgentSudoAskpassScript,
  renderAgentSudoShimScript
} from './agent-sudo-scripts'

const execFileAsync = promisify(execFile)

describe.skipIf(process.platform === 'win32')('agent sudo scripts', () => {
  let dir: string
  let shim: string
  let askpass: string
  let endpoint: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca agent-sudo '))
    const fakeSudo = join(dir, "real 'sudo'")
    writeFileSync(fakeSudo, '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n')
    chmodSync(fakeSudo, 0o700)
    shim = join(dir, 'sudo')
    writeFileSync(shim, renderAgentSudoShimScript(fakeSudo))
    chmodSync(shim, 0o700)
    askpass = join(dir, 'askpass')
    writeFileSync(askpass, renderAgentSudoAskpassScript())
    chmodSync(askpass, 0o700)
    endpoint = join(dir, 'endpoint')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function runShim(args: string[], endpointPresent = true): string[] {
    if (endpointPresent) {
      writeFileSync(endpoint, '1 token\n')
    } else {
      rmSync(endpoint, { force: true })
    }
    const result = spawnSync(shim, args, {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SUDO_ASKPASS: askpass, [AGENT_SUDO_ENDPOINT_ENV]: endpoint }
    })
    expect(result.status).toBe(0)
    return result.stdout.split('\n').slice(0, -1)
  }

  it.each([
    [
      ['apt', 'install', 'x'],
      ['-A', 'apt', 'install', 'x']
    ],
    [
      ['-u', 'root', 'ls'],
      ['-A', '-u', 'root', 'ls']
    ],
    [
      ['ls', '-S'],
      ['-A', 'ls', '-S']
    ],
    [
      ['-S', 'ls'],
      ['-S', 'ls']
    ],
    [
      ['-kS', 'ls'],
      ['-kS', 'ls']
    ],
    [
      ['-u', 'root', '-S', 'ls'],
      ['-u', 'root', '-S', 'ls']
    ],
    [
      ['--stdin', 'ls'],
      ['--stdin', 'ls']
    ],
    [
      ['-A', 'ls'],
      ['-A', 'ls']
    ],
    [
      ['sh', '-c', "echo 'a b'"],
      ['-A', 'sh', '-c', "echo 'a b'"]
    ]
  ])('forwards %j as %j', (args, expected) => {
    expect(runShim(args)).toEqual(expected)
  })

  it("restores sudo's own prompt when Orca has no endpoint published", () => {
    expect(runShim(['apt', 'update'], false)).toEqual(['apt', 'update'])
  })

  it('returns the password Orca decides on, and fails closed on denial', async () => {
    const requests: AgentSudoAskpassRequest[] = []
    let answer: string | null = 'pa$$ word'
    const server = await startAgentSudoAskpassServer({
      onRequest: async (request) => {
        requests.push(request)
        return answer
      }
    })
    try {
      writeFileSync(endpoint, server.endpointLine)
      const env = { PATH: process.env.PATH, [AGENT_SUDO_ENDPOINT_ENV]: endpoint }
      const allowed = await execFileAsync(askpass, ['[sudo] password for me: '], { env })
      expect(allowed.stdout).toBe('pa$$ word\n')
      expect(requests[0]).toMatchObject({ sudoPid: process.pid, prompt: '[sudo] password for me:' })
      expect(requests[0]?.command.length).toBeGreaterThan(0)

      answer = null
      await expect(execFileAsync(askpass, [], { env })).rejects.toMatchObject({ stdout: '' })

      writeFileSync(endpoint, server.endpointLine.replace(/ \S+/, ' wrong-token'))
      answer = 'pa$$ word'
      await expect(execFileAsync(askpass, [], { env })).rejects.toMatchObject({ stdout: '' })
      expect(requests).toHaveLength(2)
    } finally {
      await server.close()
    }
  })
})
