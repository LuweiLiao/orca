import { describe, expect, it } from 'vitest'
import type { AgentSessionConversationOutline } from '../../../../shared/agent-session-conversation-outline'
import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import type { AgentSessionReferenceLink } from '../../../../shared/agent-session-reference-link'
import { projectMapForksPastRewind, projectMapTimeline } from './project-map-timeline'

const outline: AgentSessionConversationOutline = {
  sessionId: 'claude_parent',
  cursor: { epoch: 'e2', sequence: 40 },
  // Out of order on purpose: turns follow the journal, not the reply's order.
  entries: [
    { itemId: 'u3', sequence: 30, preview: 'Third', imageCount: 0 },
    { itemId: 'u1', sequence: 10, preview: 'First', imageCount: 0, reply: 'Done first' },
    { itemId: 'u2', sequence: 20, preview: '', imageCount: 1 }
  ],
  omittedEntries: 2
}

function fork(child: string, epoch: string, sequence: number, source = 'claude_parent') {
  const entry: AgentSessionLineageEntry = {
    childSessionId: child,
    sourceSessionId: source,
    originSessionId: source,
    mode: 'transcript',
    cut: {
      journalItemId: `i${sequence}`,
      journalEpoch: epoch,
      journalSequence: sequence,
      messageCount: sequence
    },
    sourceProvider: 'claude',
    createdAt: 0
  }
  return entry
}

function link(
  target: string,
  messageId: string,
  source: string | null,
  sourceMessageCount: number | null
): AgentSessionReferenceLink {
  return {
    targetSessionId: target,
    messageId,
    messageIndex: 0,
    referenceUri: 'orca-conversation://reference/r?host=local',
    title: 'Referenced chat',
    source: source ? { sessionId: source, workspaceId: 'main' } : null,
    sourceMessageCount,
    createdAt: 0
  }
}

const nodeOf = (sessionId: string) => ({ paneKey: `pane:${sessionId}`, title: sessionId })

describe('a chat timeline', () => {
  it('puts each fork under the turn it was cut in, and a rewound one apart', () => {
    const timeline = projectMapTimeline({
      sessionId: 'claude_parent',
      outline,
      lineage: [
        fork('claude_a', 'e2', 25),
        fork('claude_b', 'e2', 30),
        fork('claude_old', 'e1', 25),
        fork('claude_elsewhere', 'e2', 25, 'claude_other')
      ],
      references: [],
      nodeOf
    })
    expect(timeline.turns.map((turn) => turn.itemId)).toEqual(['u1', 'u2', 'u3'])
    expect(timeline.omittedTurns).toBe(2)
    expect(timeline.turns[1]!.forks.map((entry) => entry.childSessionId)).toEqual(['claude_a'])
    expect(timeline.turns[2]!.forks.map((entry) => entry.childSessionId)).toEqual(['claude_b'])
    expect(timeline.rewoundForks.map((entry) => entry.childSessionId)).toEqual(['claude_old'])
  })

  it('places references sent by their message, and lists who references the chat', () => {
    const timeline = projectMapTimeline({
      sessionId: 'claude_parent',
      outline,
      lineage: [],
      references: [
        link('claude_parent', 'u1', 'claude_src', 12),
        link('claude_parent', 'gone', null, null),
        link('claude_reader', 'x', 'claude_parent', null)
      ],
      nodeOf
    })
    expect(timeline.turns[0]!.referencesSent).toEqual([
      {
        id: 'u1:orca-conversation://reference/r?host=local',
        sessionId: 'claude_src',
        node: nodeOf('claude_src'),
        snapshotCount: 12
      }
    ])
    expect(timeline.unplacedReferencesSent).toHaveLength(1)
    expect(timeline.referencedBy).toEqual([
      {
        id: 'x:orca-conversation://reference/r?host=local',
        sessionId: 'claude_reader',
        node: nodeOf('claude_reader'),
        snapshotCount: null
      }
    ])
  })
})

describe('a rewind past a fork', () => {
  it('names only children cut at or after the message, in the same epoch', () => {
    const cut = projectMapForksPastRewind(
      [
        fork('claude_before', 'e2', 15),
        fork('claude_at', 'e2', 20),
        fork('claude_after', 'e2', 35),
        fork('claude_old', 'e1', 35)
      ],
      { sessionId: 'claude_parent', epoch: 'e2', sequence: 20 }
    )
    expect(cut.map((entry) => entry.childSessionId)).toEqual(['claude_at', 'claude_after'])
  })
})
