import { describe, expect, it } from 'vitest'
import { buildGrowthTree } from './growth-tree-build'
import { growthFixture } from './growth-tree-fixture'
import { growthBarInView, growthNearestBar } from './growth-tree-keyboard-nav'
import { layoutGrowthTree } from './growth-tree-layout'
import { buildGrowthSummary } from './growth-tree-summary'
import type { GrowthTreeLineKind } from './growth-tree-types'

const tree = buildGrowthTree(growthFixture())
const layout = layoutGrowthTree({
  tree,
  mode: 'compressed',
  collapsed: new Set(),
  projectIds: null
})
const countOf = (hidden: GrowthTreeLineKind[], id: string): number | undefined =>
  buildGrowthSummary(tree, layout, { hiddenKinds: new Set(hidden) }).bundles.find(
    (bundle) => bundle.id === id
  )?.count

describe('buildGrowthSummary', () => {
  it('folds every relation between two lanes into one line that counts them', () => {
    expect(countOf([], 'bundle:a-feat>a-main')).toBe(2)
    expect(countOf([], 'bundle:a-main>a-notes')).toBe(2)
  })

  it('leaves out relations inside a lane, across projects and of a hidden kind', () => {
    const { bundles } = buildGrowthSummary(tree, layout, { hiddenKinds: new Set() })
    expect(bundles.map((bundle) => bundle.id)).toEqual([
      'bundle:a-feat>a-main',
      'bundle:a-main>a-notes'
    ])
    expect(countOf(['reference'], 'bundle:a-feat>a-main')).toBe(1)
    expect(countOf(['reference', 'derive'], 'bundle:a-feat>a-main')).toBeUndefined()
  })

  it('gives each lane a density strip that counts its chats', () => {
    const { lanes } = buildGrowthSummary(tree, layout, { hiddenKinds: new Set() })
    const strip = lanes.find((lane) => lane.laneId === 'a-main')!
    expect(strip.cells.length).toBeGreaterThan(0)
    expect(Math.max(...strip.cells.map((cell) => cell.count))).toBeGreaterThanOrEqual(1)
  })
})

describe('growthNearestBar', () => {
  const inLane = (laneId: string) =>
    [...layout.bars.values()]
      .filter((bar) => bar.laneId === laneId)
      .sort((a, b) => a.x - b.x || a.y - b.y)

  it('steps through a lane in time order and stops at its ends', () => {
    const [first, second] = inLane('a-main')
    expect(growthNearestBar(layout, first!.id, 'right')).toBe(second!.id)
    expect(growthNearestBar(layout, second!.id, 'left')).toBe(first!.id)
    expect(growthNearestBar(layout, first!.id, 'left')).toBeNull()
  })

  it('moves between lanes with up and down, and starts in the top lane', () => {
    const start = growthNearestBar(layout, null, 'down')!
    expect(layout.bars.get(start)!.laneId).toBe('a-main')
    const below = growthNearestBar(layout, 'lead', 'down')!
    expect(layout.bars.get(below)!.laneId).not.toBe('a-main')
    expect(growthNearestBar(layout, below, 'up')).not.toBeNull()
    expect(growthNearestBar(layout, start, 'up')).toBeNull()
  })

  it('knows whether a chat is inside the viewport', () => {
    const bar = layout.bars.get('lead')!
    const size = { width: 800, height: 600 }
    expect(growthBarInView(bar, { x: 0, y: 0, zoom: 1 }, size)).toBe(bar.x + bar.width <= 776)
    expect(growthBarInView(bar, { x: -5_000, y: 0, zoom: 1 }, size)).toBe(false)
  })
})
