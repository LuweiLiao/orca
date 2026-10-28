import { describe, expect, it } from 'vitest'
import { mobileChatRelations } from './mobile-chat-relations'

const entry = (child: string, source: string, extra = {}) => ({
  childSessionId: child,
  sourceSessionId: source,
  originSessionId: source,
  mode: 'transcript',
  cut: { journalItemId: 'i', journalEpoch: 'e', journalSequence: 3, messageCount: 68 },
  sourceProvider: 'claude',
  createdAt: 0,
  ...extra
})

const link = (target: string, source: string | null, sourceMessageCount: number | null) => ({
  targetSessionId: target,
  messageId: 'm',
  messageIndex: 4,
  referenceUri: 'orca-conversation://reference/x?host=local',
  title: 'Remote plan',
  source: source ? { sessionId: source, workspaceId: 'w' } : null,
  sourceMessageCount,
  createdAt: 0
})

const session = (sessionId: string, title: string) => ({
  sessionId,
  agent: 'claude',
  workspaceId: 'w',
  title
})

describe('mobileChatRelations', () => {
  it('lists the source, the forks, and the references on either side, nearest first', () => {
    const relations = mobileChatRelations('claude_me', {
      lineage: {
        entries: [
          entry('codex_child', 'claude_me', { handedOverCount: 40 }),
          entry('claude_me', 'claude_parent', { mode: 'native' })
        ],
        sessions: [session('claude_parent', 'Plan'), session('codex_child', 'Try ELK')]
      },
      references: {
        links: [
          link('claude_me', null, 9),
          link('claude_other', 'claude_me', null),
          link('claude_unrelated', 'claude_far', 2)
        ],
        sessions: [session('claude_other', 'Review')]
      }
    })
    expect(relations).toEqual([
      {
        kind: 'forked-from',
        sessionId: 'claude_parent',
        title: 'Plan',
        detail: 'Handoff · this chat started from it · 68 messages',
        agent: 'claude'
      },
      {
        kind: 'forked-into',
        sessionId: 'codex_child',
        title: 'Try ELK',
        detail: 'Handoff · started from this chat · latest 40 of 68 messages',
        agent: 'claude'
      },
      {
        kind: 'references',
        sessionId: null,
        title: 'Remote plan',
        detail: 'Referenced in message 5 · through message 9',
        agent: null
      },
      {
        kind: 'referenced-by',
        sessionId: 'claude_other',
        title: 'Review',
        detail: 'Referenced this chat in message 5 · live',
        agent: 'claude'
      }
    ])
  })

  it('lists every source of a merged hand-off once, not again as the references it carries', () => {
    const cut = { journalItemId: 'i', journalEpoch: 'e', journalSequence: 3, messageCount: 12 }
    const merged = entry('claude_me', 'claude_a', {
      sources: [
        { sessionId: 'claude_a', cut, sourceProvider: 'claude' },
        { sessionId: 'claude_b', cut, sourceProvider: 'claude', handedOverCount: 2 }
      ]
    })
    const relations = mobileChatRelations('claude_me', {
      lineage: { entries: [merged] },
      references: { links: [{ ...link('claude_me', 'claude_b', 2), messageId: 'fork-op' }] }
    })
    expect(relations.map((relation) => [relation.kind, relation.sessionId])).toEqual([
      ['forked-from', 'claude_a'],
      ['forked-from', 'claude_b']
    ])
    expect(relations.map((relation) => relation.detail)).toEqual([
      'Merged handoff · 2 sources · this chat started from it · 12 messages',
      'Merged handoff · 2 sources · this chat started from it · latest 2 of 12 messages'
    ])
  })

  it('reads a range reference from its start, and the whole span for a host without ranges', () => {
    const ranged = {
      ...link('claude_me', 'claude_src', 9),
      referenceUri: 'orca-conversation://reference/x?host=local&at=9&from=3'
    }
    const replies = { lineage: { entries: [] }, references: { links: [ranged] } }
    expect(mobileChatRelations('claude_me', replies, { readsRanges: true })[0]!.detail).toBe(
      'Referenced in message 5 · messages 4–9'
    )
    expect(mobileChatRelations('claude_me', replies)[0]!.detail).toBe(
      'Referenced in message 5 · through message 9'
    )
  })

  it('reads nothing from replies an older host shaped differently', () => {
    expect(
      mobileChatRelations('claude_me', { lineage: { entries: 'x' }, references: null })
    ).toEqual([])
  })
})
