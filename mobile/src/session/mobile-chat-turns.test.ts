import { describe, expect, it } from 'vitest'
import { hostReadsChatTurns, mobileChatTurns } from './mobile-chat-turns'

describe('mobileChatTurns', () => {
  it('counts a steer into the turn it joined and falls back for empty previews', () => {
    const result = mobileChatTurns({
      sessionId: 's',
      cursor: { epoch: 'e', sequence: 9 },
      omittedEntries: 2,
      entries: [
        { itemId: 'a', sequence: 1, preview: 'Plan it', imageCount: 0, reply: 'Done' },
        { itemId: 'b', sequence: 3, preview: 'also this', imageCount: 0, turnKey: 'a' },
        { itemId: 'c', sequence: 5, preview: '', imageCount: 2 },
        { itemId: 'd', sequence: 7, preview: '', imageCount: 0, extra: true }
      ]
    })
    expect(result.turns).toEqual([
      { itemId: 'a', number: 1, preview: 'Plan it', reply: 'Done' },
      { itemId: 'c', number: 2, preview: '2 images', reply: null },
      { itemId: 'd', number: 3, preview: 'Message', reply: null }
    ])
    expect(result.cursor).toEqual({ epoch: 'e', sequence: 9 })
    expect(result.omitted).toBe(2)
  })

  it('reads nothing from a reply of another shape', () => {
    expect(mobileChatTurns(null)).toEqual({ turns: [], cursor: null, omitted: 0 })
    expect(mobileChatTurns({ entries: 'x', cursor: 3 })).toEqual({
      turns: [],
      cursor: null,
      omitted: 0
    })
  })

  it('needs the outline capability', () => {
    expect(hostReadsChatTurns(undefined)).toBe(false)
    expect(hostReadsChatTurns(['agent-session.conversation-outline.v1'])).toBe(true)
  })
})
