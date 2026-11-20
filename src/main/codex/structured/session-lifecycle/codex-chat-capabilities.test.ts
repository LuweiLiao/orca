import { describe, expect, it } from 'vitest'
import {
  acquireReadyCodexForTest,
  adapterFor,
  fakeCodex,
  identityFor,
  THREAD_ID
} from './codex-structured-session-adapter-fixture'

const REVIEW = 'C:\\Users\\me\\.agents\\skills\\review\\SKILL.md'
const WRITING = 'C:\\Users\\me\\.agents\\skills\\writing\\SKILL.md'
const KEPT = 'C:\\Users\\me\\.agents\\skills\\old\\SKILL.md'

function codexWithTools() {
  return fakeCodex({
    'config/read': () => ({
      config: {
        mcp_servers: { zotero: {}, altium: {}, retired: { enabled: false } },
        skills: { config: [{ path: KEPT, enabled: false }] }
      }
    }),
    'skills/list': () => ({
      data: [
        {
          cwd: '/work/repo',
          skills: [
            { name: 'review', path: REVIEW, description: 'r', scope: 'user', enabled: true },
            { name: 'writing', path: WRITING, description: 'w', scope: 'user', enabled: true }
          ],
          errors: []
        }
      ]
    })
  })
}

async function started(
  codex: ReturnType<typeof codexWithTools>,
  selection: { disabledSkills: string[]; disabledMcpServers: string[] } | null
) {
  const adapter = adapterFor(codex)
  await acquireReadyCodexForTest(adapter, {
    identity: identityFor('session-1'),
    fence: 7,
    spawnToken: 'spawn-9',
    ...(selection ? { options: { chatCapabilities: JSON.stringify(selection) } } : {})
  })
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
  }
  return adapter
}

function threadConfig(codex: ReturnType<typeof codexWithTools>) {
  const open = codex.connections[0]?.calls.find((call) => call.method === 'thread/start')
  return (open?.params as { config?: Record<string, unknown> } | undefined)?.config ?? {}
}

describe("a Codex conversation's Skill and MCP selection", () => {
  it('opens the thread without configured tools it disabled, keeping the user skill entries', async () => {
    const codex = codexWithTools()
    const selection = {
      disabledSkills: ['review', 'unlisted'],
      disabledMcpServers: ['zotero', 'codex_apps', 'retired']
    }
    const adapter = await started(codex, selection)

    const config = threadConfig(codex)
    expect(config['mcp_servers.zotero.enabled']).toBe(false)
    // A plugin's or an already disabled server is not named: Codex refuses the open for it.
    expect(Object.keys(config).filter((key) => key.startsWith('mcp_servers.'))).toEqual([
      'mcp_servers.zotero.enabled'
    ])
    expect(config['skills.config']).toEqual([
      { path: KEPT, enabled: false },
      { path: REVIEW, enabled: false }
    ])
    expect(codex.connections[0]?.calls.some((call) => call.method === 'config/value/write')).toBe(
      false
    )

    expect(
      adapter.requiresRestartForOptions('session-1', {
        chatCapabilities: JSON.stringify({
          disabledSkills: ['unlisted', 'review'],
          disabledMcpServers: ['retired', 'codex_apps', 'zotero']
        })
      })
    ).toBe(false)
    expect(adapter.requiresRestartForOptions('session-1', {})).toBe(true)
    await adapter.closeSession('session-1')
  })

  it('reports configured, plugin and disabled servers with what can be switched', async () => {
    const codex = codexWithTools()
    const adapter = await started(codex, null)
    expect(threadConfig(codex)['skills.config']).toBeUndefined()
    const notify = codex.connections[0]?.handlers.onNotification
    notify?.('mcpServer/startupStatus/updated', {
      threadId: THREAD_ID,
      name: 'altium',
      status: 'ready',
      error: null,
      failureReason: null
    })
    notify?.('mcpServer/startupStatus/updated', {
      threadId: THREAD_ID,
      name: 'cua_repl',
      status: 'starting',
      error: null,
      failureReason: null
    })
    notify?.('mcpServer/startupStatus/updated', {
      threadId: 'other-thread',
      name: 'zotero',
      status: 'failed',
      error: null,
      failureReason: null
    })

    const options = await adapter.readOptions({ sessionId: 'session-1', fence: 7 })
    expect(options.chatCapabilities?.mcpServers).toEqual([
      { name: 'zotero', status: '' },
      { name: 'altium', status: 'connected' },
      { name: 'retired', status: 'disabled', locked: 'config-disabled' },
      { name: 'cua_repl', status: 'pending', locked: 'plugin' }
    ])
    expect(options.chatCapabilities?.skills.map((skill) => skill.name)).toEqual([
      'review',
      'writing'
    ])
    expect(adapter.requiresRestartForOptions('session-1', {})).toBe(false)
    await adapter.closeSession('session-1')
  })

  it('refuses to open when Codex cannot report the configuration a selection needs', async () => {
    const codex = fakeCodex({
      'config/read': () => {
        throw new Error('unknown variant `config/read`')
      }
    })
    const adapter = adapterFor(codex)
    await expect(
      acquireReadyCodexForTest(adapter, {
        identity: identityFor('session-1'),
        fence: 7,
        spawnToken: 'spawn-9',
        options: {
          chatCapabilities: JSON.stringify({ disabledSkills: [], disabledMcpServers: ['zotero'] })
        }
      })
    ).rejects.toThrow('Skill/MCP selection')
    expect(codex.connections[0]?.calls.some((call) => call.method === 'thread/start')).toBe(false)
  })
})
