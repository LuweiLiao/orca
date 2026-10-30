import { describe, expect, it } from 'vitest'
import { buildGrowthTree } from './growth-tree-build'
import { growthFixture } from './growth-tree-fixture'
import { growthNearestRow, growthScrollToRow } from './growth-tree-keyboard-nav'
import { layoutGrowthTree } from './growth-tree-layout'
import { growthTreeAt } from './growth-tree-replay'

const tree = buildGrowthTree(growthFixture())
const draw = (collapsed = new Set<string>()) =>
  layoutGrowthTree({ tree, collapsed, projectIds: null })

describe('layoutGrowthTree', () => {
  it('lays the same tree out the same way', () => {
    const a = draw()
    const b = draw()
    expect([...a.rows.values()]).toEqual([...b.rows.values()])
    expect(a.wires).toEqual(b.wires)
    expect(a.height).toBe(b.height)
  })

  it('gives every chat its own row, newest on top within a project', () => {
    const layout = draw()
    const ys = [...layout.rows.values()].map((row) => row.y)
    expect(new Set(ys).size).toBe(ys.length)
    for (const project of tree.projects) {
      const bars = [...tree.bars.values()]
        .filter((bar) => bar.projectId === project.id)
        .sort((a, b) => b.start - a.start)
      for (let i = 1; i < bars.length; i++) {
        expect(layout.rows.get(bars[i]!.id)!.y).toBeGreaterThan(layout.rows.get(bars[i - 1]!.id)!.y)
      }
    }
  })

  it('keeps a workspace in one column and never lets two live workspaces share one', () => {
    const layout = draw()
    for (const row of layout.rows.values()) {
      expect(row.cx).toBe(layout.lanes.get(row.laneId)!.x)
    }
    const lanes = [...layout.lanes.values()].filter((lane) => lane.top !== null)
    for (const a of lanes) {
      for (const b of lanes) {
        if (a.id < b.id && a.projectId === b.projectId && a.column === b.column) {
          expect(a.bottom! < b.top! || b.bottom! < a.top!).toBe(true)
        }
      }
    }
  })

  it('branches a derived workspace off to the right of its parent, never a folder', () => {
    const layout = draw()
    const derives = layout.wires.filter((wire) => wire.kind === 'derive')
    expect(derives.map((wire) => [wire.from, wire.to])).toEqual([['a-main', 'a-feat']])
    expect(layout.lanes.get('a-feat')!.column).toBeGreaterThan(layout.lanes.get('a-main')!.column)
    expect(derives[0]!.color).toBe(layout.lanes.get('a-feat')!.color)
  })

  it('marks only the newest row of each workspace as its tip', () => {
    const layout = draw()
    const tips = [...layout.rows.values()].filter((row) => row.tip)
    expect(tips.map((row) => row.laneId).sort()).toEqual(
      [...new Set([...layout.rows.values()].map((row) => row.laneId))].sort()
    )
    for (const tip of tips) {
      for (const row of layout.rows.values()) {
        if (row.laneId === tip.laneId) {
          expect(row.y).toBeGreaterThanOrEqual(tip.y)
        }
      }
    }
  })

  it('sends every merge source straight into the merged chat', () => {
    const into = draw().wires.filter((wire) => wire.to === 'merged')
    expect(into.map((wire) => wire.id).sort()).toEqual([
      'handoff:s1>merged',
      'merge:s2>merged',
      'merge:s3>merged'
    ])
  })

  it('puts a chip on each end of a cross-project delegation and no long wire', () => {
    const layout = draw()
    expect(
      layout.pins
        .filter((pin) => pin.kind !== 'unresolved')
        .map((pin) => pin.id)
        .sort()
    ).toEqual(['pin:cross-in:b-chat:repo-a', 'pin:cross-out:lead:repo-b'])
    expect(layout.wires.some((wire) => wire.to === 'b-chat')).toBe(false)
  })

  it('draws a collapsed project as its header only, keeping the chip that leads back into it', () => {
    const layout = draw(new Set(['repo-a']))
    expect([...layout.rows.keys()]).toEqual(['b-chat'])
    expect(layout.wires).toEqual([])
    expect(layout.pins.map((pin) => pin.id)).toEqual(['pin:cross-in:b-chat:repo-a'])
    expect(layout.textX).toBe(draw().textX)
  })

  it('exports a path for every wire and a box for every dot', () => {
    const layout = draw()
    expect([...layout.paths.edges.keys()].sort()).toEqual(
      layout.wires.map((wire) => wire.id).sort()
    )
    for (const id of layout.rows.keys()) {
      expect(layout.paths.nodes.has(id)).toBe(true)
    }
  })

  it('draws references without moving any chat', () => {
    const layout = draw()
    expect(layout.wires.find((wire) => wire.id === 'reference:feat-chat>lead')).toMatchObject({
      kind: 'reference',
      from: 'feat-chat',
      to: 'lead'
    })
    const bare = layoutGrowthTree({
      tree: { ...tree, references: [] },
      collapsed: new Set(),
      projectIds: null
    })
    expect([...layout.rows.values()]).toEqual([...bare.rows.values()])
  })

  it('keeps every row in place while a replay shows only part of the tree', () => {
    const full = draw()
    const shown = growthTreeAt(tree, 4_150_000)
    const partial = layoutGrowthTree({
      tree,
      collapsed: new Set(),
      projectIds: null,
      shown
    })
    expect(partial.rows.size).toBeLessThan(full.rows.size)
    for (const row of partial.rows.values()) {
      expect({ ...row, tip: false }).toEqual({
        ...full.rows.get(row.id)!,
        tip: false
      })
    }
    expect(partial.rows.has('merged')).toBe(false)
  })
})

describe('growth tree keys', () => {
  const layout = draw()
  const rows = [...layout.rows.values()].sort((a, b) => a.y - b.y)

  it('steps down and up through the rows as drawn', () => {
    expect(growthNearestRow(layout, null, 'down')).toBe(rows[0]!.id)
    expect(growthNearestRow(layout, rows[0]!.id, 'down')).toBe(rows[1]!.id)
    expect(growthNearestRow(layout, rows[1]!.id, 'up')).toBe(rows[0]!.id)
  })

  it('moves right into the derived workspace column', () => {
    const lead = layout.rows.get('lead')!
    const next = growthNearestRow(layout, 'lead', 'right')
    expect(layout.rows.get(next!)!.cx).toBeGreaterThan(lead.cx)
  })

  it('scrolls only as far as needed to bring a row into view', () => {
    expect(growthScrollToRow({ y: 100 }, 30, { top: 0, height: 400 })).toBe(0)
    expect(growthScrollToRow({ y: 500 }, 30, { top: 0, height: 400 })).toBe(154)
    expect(growthScrollToRow({ y: 100 }, 30, { top: 300, height: 400 })).toBe(-224)
  })
})
