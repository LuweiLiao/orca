import { describe, expect, it } from 'vitest'
import { buildGrowthTree } from './growth-tree-build'
import { growthFixture } from './growth-tree-fixture'
import { layoutGrowthTree } from './growth-tree-layout'
import { buildGrowthScale, growthGapWidth } from './growth-tree-scale'

const tree = buildGrowthTree(growthFixture())
const draw = (mode: 'compressed' | 'sequence' = 'compressed', collapsed = new Set<string>()) =>
  layoutGrowthTree({ tree, mode, collapsed, projectIds: null })

describe('buildGrowthScale', () => {
  const times = [0, 1_000, 5_000, 60_000, 3_600_000, 3 * 86_400_000, 3 * 86_400_000 + 5]

  it('keeps the order of moments in both modes', () => {
    for (const mode of ['compressed', 'sequence'] as const) {
      const scale = buildGrowthScale(times, mode)
      const xs = times.map((time) => scale.xOf(time))
      expect(xs).toEqual([...xs].sort((a, b) => a - b))
      expect(new Set(xs).size).toBe(times.length)
    }
  })

  it('folds a gap over a day and widens longer gaps by less than their length', () => {
    const scale = buildGrowthScale(times, 'compressed')
    expect(scale.folds).toHaveLength(1)
    expect(growthGapWidth(60_000)).toBeLessThan(growthGapWidth(3_600_000))
    expect(growthGapWidth(1e12)).toBeLessThanOrEqual(140)
  })

  it('gives the same scale for the same moments in any order', () => {
    const a = buildGrowthScale(times, 'compressed')
    const b = buildGrowthScale(times.toReversed(), 'compressed')
    expect(a.points).toEqual(b.points)
  })
})

describe('layoutGrowthTree', () => {
  it('lays the same tree out the same way', () => {
    const a = draw()
    const b = draw()
    expect([...a.bars.values()]).toEqual([...b.bars.values()])
    expect(a.wires).toEqual(b.wires)
    expect(a.height).toBe(b.height)
  })

  it('never lets a later chat start left of an earlier one in compressed time or event order', () => {
    for (const mode of ['compressed', 'sequence'] as const) {
      const layout = draw(mode)
      const bars = [...tree.bars.values()].sort((a, b) => a.start - b.start)
      for (let i = 1; i < bars.length; i++) {
        expect(layout.bars.get(bars[i]!.id)!.x).toBeGreaterThanOrEqual(
          layout.bars.get(bars[i - 1]!.id)!.x
        )
      }
    }
  })

  it('never overlaps two chats on one track', () => {
    const layout = draw()
    const seen = [...layout.bars.values()]
    for (const a of seen) {
      for (const b of seen) {
        if (a.id < b.id && a.laneId === b.laneId && a.track === b.track) {
          expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true)
        }
      }
    }
  })

  it('draws a derive wire but none into the folder lane', () => {
    const layout = draw()
    const derives = layout.wires.filter((wire) => wire.kind === 'derive')
    expect(derives.map((wire) => wire.to)).toEqual(['a-feat'])
  })

  it('joins several merge sources at one hollow point left of the merged chat', () => {
    const layout = draw()
    expect(layout.joins.map((join) => join.id)).toEqual(['join:merged'])
    const merged = layout.bars.get('merged')!
    expect(layout.joins[0]!.x).toBeLessThan(merged.x)
    const into = layout.wires.filter((wire) => wire.to === 'merged')
    expect(into.map((wire) => wire.id).sort()).toEqual([
      'handoff:s1>merged',
      'joinout:merged',
      'merge:s2>merged',
      'merge:s3>merged'
    ])
  })

  it('puts a pin at each end of a cross-project delegation and no long wire', () => {
    const layout = draw()
    expect(
      layout.pins
        .filter((pin) => pin.kind !== 'unresolved')
        .map((pin) => pin.id)
        .sort()
    ).toEqual(['pin:cross-in:b-chat:repo-a', 'pin:cross-out:lead:repo-b'])
    expect(layout.wires.some((wire) => wire.to === 'b-chat')).toBe(false)
  })

  it('draws a collapsed project as its header only, keeping the pin that leads back into it', () => {
    const layout = draw('compressed', new Set(['repo-a']))
    expect([...layout.bars.keys()]).toEqual(['b-chat'])
    expect(layout.wires).toEqual([])
    expect(layout.pins.map((pin) => pin.id)).toEqual(['pin:cross-in:b-chat:repo-a'])
    expect(layout.groups.find((group) => group.projectId === 'repo-a')!.collapsed).toBe(true)
  })

  it('exports a path for every wire and a box for every node', () => {
    const layout = draw()
    expect([...layout.paths.edges.keys()].sort()).toEqual(
      layout.wires.map((wire) => wire.id).sort()
    )
    for (const id of [...layout.bars.keys(), ...layout.lanes.keys()]) {
      expect(layout.paths.nodes.has(id)).toBe(true)
    }
  })
})
