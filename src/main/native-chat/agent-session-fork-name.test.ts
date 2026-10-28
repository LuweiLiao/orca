import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'

import { withConversationReferenceInstructions } from '../../shared/conversation-reference'
import {
  applyForkedChatName,
  forkedChatFallbackName,
  forkedChatNameUpdate,
  legacyForkedChatRename,
  oneSourceMergeRename
} from './agent-session-fork-name'

type Names = Pick<AgentSessionRecord, 'conversationName' | 'conversationNameSource'>

const HANDOFF_SEED = 'This conversation continues from another Orca…'
const fallback = 'Handoff: Lineage data'

/** A store whose namer commits its seed just before the first write lands, as on real Codex runs. */
function storeSeededMidway(initial: Names) {
  let record = initial
  let writes = 0
  return {
    read: () => record,
    getRecord: () => record,
    compareAndSetConversationName: async (
      _sessionId: string,
      name: string,
      expected: string | null,
      sourceKind: 'seed',
      expectedSource: Names['conversationNameSource'] | null
    ) => {
      if (writes++ === 0) {
        record = { conversationName: HANDOFF_SEED, conversationNameSource: 'seed' }
      }
      const matched =
        (record.conversationName ?? null) === expected &&
        (record.conversationNameSource ?? null) === expectedSource
      if (!matched) {
        return null
      }
      record = { conversationName: name, conversationNameSource: sourceKind }
      return record
    }
  }
}

describe('applyForkedChatName', () => {
  it('names the child after its instruction even when the namer seeded from the hand-off first', async () => {
    const store = storeSeededMidway({})
    await applyForkedChatName(store, 'codex_child', fallback, 'FORK-5: compare layouts')
    expect(store.read()).toEqual({
      conversationName: 'FORK-5: compare layouts',
      conversationNameSource: 'seed'
    })
  })

  it('keeps a name the person or the namer already settled on', async () => {
    for (const kind of ['manual', 'generated'] as const) {
      const store = storeSeededMidway({ conversationName: 'Settled', conversationNameSource: kind })
      expect(await applyForkedChatName(store, 'codex_child', fallback, 'try it')).toBeNull()
    }
  })
})

describe('forkedChatFallbackName', () => {
  it('names a hand-off after its source, and a merge after its sources as equals', () => {
    expect(forkedChatFallbackName(['Lineage data'])).toBe('Handoff: Lineage data')
    expect(forkedChatFallbackName(['Lineage data', 'Wires'])).toBe(
      'Merged handoff: Lineage data and Wires'
    )
    expect(forkedChatFallbackName(['Lineage data', 'Wires', 'Rows'])).toBe(
      'Merged handoff: Lineage data and others, 3 chats'
    )
    expect(forkedChatFallbackName([null, null])).toBeNull()
  })

  it('says one title once, and does not stack prefixes when a source was itself merged', () => {
    expect(forkedChatFallbackName(['Lanes', 'Lanes'])).toBe(
      'Merged handoff: Lanes and others, 2 chats'
    )
    expect(forkedChatFallbackName(['Merged handoff: Lanes and Wires', 'Lanes'])).toBe(
      'Merged handoff: Lanes and Wires and Lanes'
    )
  })

  it('keeps one prefix when the source was itself a hand-off', () => {
    expect(forkedChatFallbackName(['Handoff: Lineage data'])).toBe('Handoff: Lineage data')
  })
})

describe('legacyForkedChatRename', () => {
  it('renames an automatic "Fork of" name once, however deep, and leaves chosen names', () => {
    const seed = 'seed' as const
    const deep = { conversationName: 'Fork of Fork of Plan', conversationNameSource: seed }
    expect(legacyForkedChatRename(deep, 1)).toBe('Handoff: Plan')
    expect(legacyForkedChatRename({ conversationName: 'Fork of Plan' }, 2)).toBe(
      'Merged handoff: Plan and others, 2 chats'
    )
    const manual = { conversationName: 'Fork of Plan', conversationNameSource: 'manual' as const }
    expect(legacyForkedChatRename(manual, 1)).toBeNull()
    expect(
      legacyForkedChatRename({ conversationName: 'Plan', conversationNameSource: seed }, 1)
    ).toBeNull()
  })
})

describe('forkedChatNameUpdate', () => {
  it('names a child after the typed instruction, not the references sent with it', () => {
    const uri = 'orca-conversation://reference/00000000-0000-4000-8000-000000000000?host=local'
    const instruction = withConversationReferenceInstructions(`Merge these [Plan](${uri})`)
    expect(forkedChatNameUpdate(null, fallback, instruction)?.name).toBe('Merge these')
  })

  it('names an unnamed child after its source when no instruction was given', () => {
    expect(forkedChatNameUpdate(null, fallback, undefined)).toEqual({
      name: 'Handoff: Lineage data',
      expected: null,
      expectedSource: null
    })
  })
})

describe('oneSourceMergeRename', () => {
  it('renames a merge first named after one source, and nothing it should leave', () => {
    const seed = 'seed' as const
    const old = { conversationName: '合并交接：续研 和另外 1 个对话', conversationNameSource: seed }
    expect(oneSourceMergeRename(old, ['Lineage', 'Wires'])).toBe(
      'Merged handoff: Lineage and Wires'
    )
    const english = {
      conversationName: 'Merged handoff: Lineage and 2 more',
      conversationNameSource: seed
    }
    expect(oneSourceMergeRename(english, ['Lineage', 'Wires', 'Rows'])).toBe(
      'Merged handoff: Lineage and others, 3 chats'
    )
    expect(
      oneSourceMergeRename({ ...old, conversationNameSource: 'manual' }, ['A', 'B'])
    ).toBeNull()
    expect(
      oneSourceMergeRename({ conversationName: 'Compare lanes', conversationNameSource: seed }, [
        'A',
        'B'
      ])
    ).toBeNull()
  })
})

describe('oneSourceMergeRename on names this build gives', () => {
  it('fixes stacked prefixes and a title said twice, and leaves a name already current', () => {
    const seed = 'seed' as const
    const stacked = {
      conversationName: 'Merged handoff: Merged handoff: Lanes and Lanes and Lanes',
      conversationNameSource: seed
    }
    expect(oneSourceMergeRename(stacked, ['Merged handoff: Lanes and Wires', 'Lanes'])).toBe(
      'Merged handoff: Lanes and Wires and Lanes'
    )
    const current = {
      conversationName: 'Merged handoff: Lanes and Wires',
      conversationNameSource: seed
    }
    expect(oneSourceMergeRename(current, ['Lanes', 'Wires'])).toBeNull()
  })
})
