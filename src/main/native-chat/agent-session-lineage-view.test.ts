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
  ['claude_root', 'claude_mid', 'claude_leaf', 'claude_other', 'claude_merged', 'claude_side'].map(
    (sessionId) => [
      sessionId,
      {
        provider: 'claude',
        conversationName: sessionId.replace('claude_', ''),
        location: { workspaceId: 'repo::/main' }
      }
    ]
  )
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

  it('joins a merged child to every chat it was handed, and describes each', () => {
    const merged: AgentSessionLineageEntry = {
      ...forked('claude_merged', 'claude_root'),
      mode: 'transcript',
      sources: [
        { sessionId: 'claude_root', cut: forked('x', 'y').cut, sourceProvider: 'claude' },
        { sessionId: 'claude_side', cut: forked('x', 'y').cut, sourceProvider: 'claude' }
      ]
    }
    // Asked about the second source only, the merge is still found through it.
    const view = agentSessionLineageView([merged], (id) => records.get(id), ['claude_side'])
    expect(view.entries.map((entry) => entry.childSessionId)).toEqual(['claude_merged'])
    expect(view.sessions.map((session) => session.sessionId).sort()).toEqual([
      'claude_merged',
      'claude_root',
      'claude_side'
    ])
  })
})
