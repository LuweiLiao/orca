import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { resolveStructuredAgentCommand } from '../../../native-chat/agent-launch/structured-agent-command-resolution'
import { resolveClaudeChildEnvSources } from './claude-structured-child-env'

it("resolves a launcher chat's own command instead of Claude's", async () => {
  const root = mkdtempSync(join(tmpdir(), 'orca-claude-launcher-'))
  try {
    const name = (base: string) => join(root, process.platform === 'win32' ? `${base}.cmd` : base)
    for (const base of ['claude', 'ccb']) {
      writeFileSync(name(base), '#!/bin/sh\nexit 0\n')
      chmodSync(name(base), 0o755)
    }
    const read = (launcher?: 'ccb') =>
      resolveClaudeChildEnvSources({
        resolveCommand: (options) => resolveStructuredAgentCommand('claude', {}, options),
        ...(launcher ? { launcher } : {}),
        resolveEnv: async () => ({}),
        resolveInheritedEnv: async () => ({ PATH: root, HOME: root })
      })
    expect((await read('ccb')).command).toBe(name('ccb'))
    expect((await read()).command).toBe(name('claude'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
