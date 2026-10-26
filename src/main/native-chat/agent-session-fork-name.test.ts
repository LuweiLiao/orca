import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'

import { forkedChatNameUpdate } from './agent-session-fork-name'

const child = (
  conversationName?: string,
  conversationNameSource?: AgentSessionRecord['conversationNameSource']
): Pick<AgentSessionRecord, 'conversationName' | 'conversationNameSource'> => ({
  conversationName,
  conversationNameSource
})

describe('forkedChatNameUpdate', () => {
  it('replaces a seed the namer took from the hand-off before the fork named the chat', () => {
    expect(
      forkedChatNameUpdate(
        child('This conversation continues from another Orca…', 'seed'),
        { conversationName: 'Lineage data' },
        'FORK-2: compare layouts'
      )
    ).toEqual({
      name: 'FORK-2: compare layouts',
      expected: 'This conversation continues from another Orca…',
      expectedSource: 'seed'
    })
  })

  it('keeps a name the person or the namer already settled on', () => {
    const source = { conversationName: 'Lineage data' }
    expect(forkedChatNameUpdate(child('Renamed', 'manual'), source, 'try it')).toBeNull()
    expect(forkedChatNameUpdate(child('Generated', 'generated'), source, 'try it')).toBeNull()
  })

  it('names an unnamed child after its source when no instruction was given', () => {
    expect(forkedChatNameUpdate(null, { conversationName: 'Lineage data' }, undefined)).toEqual({
      name: 'Fork of Lineage data',
      expected: null,
      expectedSource: null
    })
  })
})
