import type { GrowthTreeFilter } from './growth-tree-focus'
import type { GrowthLayout } from './growth-tree-layout'
import { wirePath } from './project-map-wires'
import type { GrowthTree } from './growth-tree-types'

/** Below this zoom a lane is a density strip and its lines bundle by lane pair. */
export const GROWTH_SUMMARY_ZOOM = 0.5

const CELL_PX = 24

export type GrowthSummaryCell = { x: number; count: number; working: number }
export type GrowthSummaryLane = { laneId: string; cells: GrowthSummaryCell[] }
export type GrowthSummaryBundle = {
  id: string
  fromLane: string
  toLane: string
  /** Relations folded into this line. */
  count: number
  path: string
  labelX: number
  labelY: number
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The summary tier: how busy each lane is along the axis, and every relation between two lanes
 * folded into one line that says how many it stands for. Relations inside a lane, across
 * projects and of a hidden kind are left out.
 */
export function buildGrowthSummary(
  tree: GrowthTree,
  layout: GrowthLayout,
  filter: Pick<GrowthTreeFilter, 'hiddenKinds'>
): { lanes: GrowthSummaryLane[]; bundles: GrowthSummaryBundle[] } {
  const laneOf = (id: string): string | null =>
    tree.bars.get(id)?.workspaceId ?? (tree.lanes.has(id) ? id : null)
  const lanes: GrowthSummaryLane[] = []
  for (const laneId of layout.lanes.keys()) {
    const cells = new Map<number, GrowthSummaryCell>()
    for (const barId of tree.lanes.get(laneId)?.barIds ?? []) {
      const bar = tree.bars.get(barId)!
      const first = Math.floor(layout.scale.xOf(bar.start) / CELL_PX)
      const last = Math.floor(layout.scale.xOf(bar.end) / CELL_PX)
      for (let index = first; index <= last; index++) {
        const cell = cells.get(index) ?? { x: index * CELL_PX, count: 0, working: 0 }
        cell.count += 1
        cell.working += bar.bucket === 'working' ? 1 : 0
        cells.set(index, cell)
      }
    }
    lanes.push({ laneId, cells: [...cells.values()].sort((a, b) => a.x - b.x) })
  }
  const counted = new Map<string, { from: string; to: string; count: number; at: number }>()
  const relations = [
    ...tree.edges.map(({ kind, from, to, at }) => ({ kind, from, to, at })),
    ...tree.references.map(({ from, to, at }) => ({ kind: 'reference' as const, from, to, at }))
  ]
  for (const relation of relations) {
    const from = laneOf(relation.from)
    const to = laneOf(relation.to)
    if (!from || !to || from === to || filter.hiddenKinds.has(relation.kind)) {
      continue
    }
    if (!layout.lanes.has(from) || !layout.lanes.has(to)) {
      continue
    }
    const [first, second] = from < to ? [from, to] : [to, from]
    const key = `${first}>${second}`
    const entry = counted.get(key) ?? { from: first, to: second, count: 0, at: relation.at }
    entry.count += 1
    entry.at = Math.min(entry.at, relation.at)
    counted.set(key, entry)
  }
  const bundles = [...counted.values()]
    .map((entry): GrowthSummaryBundle => {
      const a = layout.lanes.get(entry.from)!
      const b = layout.lanes.get(entry.to)!
      const x = layout.scale.xOf(entry.at)
      const y0 = a.y + a.height / 2
      const y1 = b.y + b.height / 2
      return {
        id: `bundle:${entry.from}>${entry.to}`,
        fromLane: entry.from,
        toLane: entry.to,
        count: entry.count,
        path: wirePath(x - 36, y0, x, y1),
        labelX: x - 18,
        labelY: (y0 + y1) / 2
      }
    })
    .sort((a, b) => cmp(a.id, b.id))
  return { lanes, bundles }
}
