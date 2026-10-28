import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'

import { withConversationReferenceInstructions } from '../../shared/conversation-reference'
import {
  applyForkedChatName,
  forkedChatFallbackName,
  forkedChatNameUpdate
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
  it('names a hand-off after its source, and a merged one after its primary and the rest', () => {
    expect(forkedChatFallbackName('Lineage data', 1)).toBe('Handoff: Lineage data')
    expect(forkedChatFallbackName('Lineage data', 3)).toBe(
      'Merged handoff: Lineage data and 2 more'
    )
    expect(forkedChatFallbackName(null, 2)).toBeNull()
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
