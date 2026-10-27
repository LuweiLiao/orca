import { describe, expect, it } from 'vitest'
import type { AgentSessionLineageEntry } from '../../shared/agent-session-fork'

import { agentSessionLineageView } from './agent-session-lineage-view'

const forked = (child: string, source: string): AgentSessionLineageEntry => ({
  childSessionId: child,
  sourceSessionId: source,
  originSessionId: source,
  mode: 'native',
  cut: { journalItemId: 'i', journalEpoch: 'e', journalSequence: 1, messageCount: 1 },
  sourceProvider: 'claude',
  createdAt: 0
})

const records = new Map(
  ['claude_root', 'claude_mid', 'claude_leaf', 'claude_other'].map((sessionId) => [
    sessionId,
    {
      provider: 'claude',
      conversationName: sessionId.replace('claude_', ''),
      location: { workspaceId: 'repo::/main' }
    }
  ])
)

// root → mid → leaf, and an unrelated other → never-made child.
const table = [
  forked('claude_mid', 'claude_root'),
  forked('claude_leaf', 'claude_mid'),
  forked('claude_unmade', 'claude_other')
]

describe('agentSessionLineageView', () => {
  it('follows the chain through a closed chat and describes every chat it touches', () => {
    const view = agentSessionLineageView(table, (id) => records.get(id), ['claude_leaf'])
    expect(view.entries.map((entry) => entry.childSessionId)).toEqual(['claude_mid', 'claude_leaf'])
    expect(view.sessions).toEqual(
      expect.arrayContaining([
        { sessionId: 'claude_root', agent: 'claude', workspaceId: 'repo::/main', title: 'root' },
        { sessionId: 'claude_mid', agent: 'claude', workspaceId: 'repo::/main', title: 'mid' }
      ])
    )
  })

  it('leaves out a fork whose child was never made', () => {
    const view = agentSessionLineageView(table, (id) => records.get(id), undefined)
    expect(view.entries.map((entry) => entry.childSessionId)).toEqual(['claude_mid', 'claude_leaf'])
    expect(view.sessions.map((session) => session.sessionId)).not.toContain('claude_other')
  })
})
