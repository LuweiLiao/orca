import { describe, expect, it } from 'vitest'
import { shareHandoffBudget } from './agent-session-merge-handoff'

describe('sharing the hand-off budget', () => {
  it('lets small chats take what they need and splits the rest among the large ones', () => {
    expect(shareHandoffBudget([1_000, 50_000, 50_000], 41_000)).toEqual([1_000, 20_000, 20_000])
  })

  it('gives every chat all it asks for when they fit together', () => {
    expect(shareHandoffBudget([300, 700], 10_000)).toEqual([300, 700])
  })
})
