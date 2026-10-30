import { describe, expect, it } from 'vitest'
import { buildGrowthTree } from './growth-tree-build'
import { GROWTH_NOW, growthFixture } from './growth-tree-fixture'
import { GROWTH_EMPTY_FILTER, growthBarMatches, growthFocus } from './growth-tree-focus'

const tree = buildGrowthTree(growthFixture())

describe('growthFocus', () => {
  it('follows a merged chat up to every source and down to nothing', () => {
    const focus = growthFocus(tree, 'merged')!
    for (const source of ['s1', 's2', 's3']) {
      expect(focus.nodes.has(source)).toBe(true)
    }
    expect(focus.nodes.has('lead')).toBe(false)
  })

  it('follows a delegator down across projects', () => {
    const focus = growthFocus(tree, 'lead')!
    expect(focus.nodes.has('b-chat')).toBe(true)
    expect(focus.edges.has('delegate:lead>b-chat')).toBe(true)
  })

  it('takes a lane as its chats and what they lead to', () => {
    expect(growthFocus(tree, 'a-feat')!.nodes.has('feat-chat')).toBe(true)
    expect(growthFocus(tree, null)).toBeNull()
  })
})

describe('growthBarMatches', () => {
  it('dims by status and by window, never by removal', () => {
    const worker = tree.bars.get('worker')!
    expect(growthBarMatches(worker, GROWTH_EMPTY_FILTER, GROWTH_NOW)).toBe(true)
    expect(
      growthBarMatches(
        worker,
        { ...GROWTH_EMPTY_FILTER, buckets: new Set(['working']) },
        GROWTH_NOW
      )
    ).toBe(false)
    expect(
      growthBarMatches(
        worker,
        { ...GROWTH_EMPTY_FILTER, window: 'today' },
        3_000_000 + 8 * 86_400_000
      )
    ).toBe(false)
  })
})
