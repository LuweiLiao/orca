import { buildGrowthScale, type GrowthTimeMode } from './growth-tree-scale'
import { growthTreeTicks } from './growth-tree-ticks'
import { buildGrowthWires } from './growth-tree-wires'
import type { GrowthTree, GrowthTreeBar } from './growth-tree-types'
import {
  GROWTH_LAYOUT,
  type GrowthBox,
  type GrowthLayout,
  type GrowthLayoutBar,
  type GrowthLayoutGroup,
  type GrowthLayoutLane
} from './growth-tree-layout-types'

export * from './growth-tree-layout-types'

export type GrowthLayoutInput = {
  tree: GrowthTree
  mode: GrowthTimeMode
  /** Project groups drawn as a header only. */
  collapsed: ReadonlySet<string>
  /** Projects drawn; null draws all. */
  projectIds: ReadonlySet<string> | null
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Chats on the lowest free track of their lane, a delegated chat on its delegator's when free. */
function assignTracks(
  bars: readonly GrowthTreeBar[],
  parentOf: ReadonlyMap<string, string>,
  span: (bar: GrowthTreeBar) => { x: number; right: number }
): Map<string, number> {
  const ends: number[] = []
  const tracks = new Map<string, number>()
  for (const bar of [...bars].sort((a, b) => a.start - b.start || cmp(a.id, b.id))) {
    const { x, right } = span(bar)
    const free = (track: number): boolean =>
      (ends[track] ?? Number.NEGATIVE_INFINITY) + GROWTH_LAYOUT.trackGap <= x
    const preferred = tracks.get(parentOf.get(bar.id) ?? '')
    let track =
      preferred !== undefined && free(preferred) ? preferred : ends.findIndex((_, i) => free(i))
    if (track < 0) {
      track = ends.length
    }
    ends[track] = right
    tracks.set(bar.id, track)
  }
  return tracks
}

export function layoutGrowthTree({
  tree,
  mode,
  collapsed,
  projectIds
}: GrowthLayoutInput): GrowthLayout {
  const L = GROWTH_LAYOUT
  const shown = tree.projects.filter((project) => projectIds === null || projectIds.has(project.id))
  const shownIds = new Set(shown.map((project) => project.id))
  const times = [tree.now]
  for (const bar of tree.bars.values()) {
    if (shownIds.has(bar.projectId)) {
      times.push(bar.start, bar.end)
    }
  }
  for (const edge of tree.edges) {
    if (shownIds.has(edge.projectId)) {
      times.push(edge.at)
    }
  }
  const scale = buildGrowthScale(times, mode)
  const spanOf = (bar: GrowthTreeBar): { x: number; right: number } => {
    const x = scale.xOf(bar.start)
    return { x, right: Math.max(scale.xOf(bar.end), x + L.minBarWidth) }
  }
  const sameLaneSource = new Map<string, string>()
  for (const edge of tree.edges) {
    if (
      edge.kind !== 'derive' &&
      tree.bars.get(edge.from)?.workspaceId === tree.bars.get(edge.to)?.workspaceId
    ) {
      sameLaneSource.set(edge.to, sameLaneSource.get(edge.to) ?? edge.from)
    }
  }

  const groups: GrowthLayoutGroup[] = []
  const lanes = new Map<string, GrowthLayoutLane>()
  const bars = new Map<string, GrowthLayoutBar>()
  let y = L.top
  for (const project of shown) {
    const isCollapsed = collapsed.has(project.id)
    const top = y
    y += L.groupHeader
    if (!isCollapsed) {
      for (const laneId of project.laneIds) {
        const lane = tree.lanes.get(laneId)!
        const laneBars = lane.barIds.map((id) => tree.bars.get(id)!)
        const tracks = assignTracks(laneBars, sameLaneSource, spanOf)
        const trackCount = Math.max(1, ...[...tracks.values()].map((track) => track + 1))
        const height = trackCount * L.trackHeight + L.lanePadding * 2
        lanes.set(laneId, {
          id: laneId,
          projectId: project.id,
          x: 0,
          y,
          width: 0,
          height,
          trackCount
        })
        for (const bar of laneBars) {
          const { x, right } = spanOf(bar)
          const track = tracks.get(bar.id)!
          bars.set(bar.id, {
            id: bar.id,
            laneId,
            track,
            x,
            width: right - x,
            height: L.barHeight,
            y: y + L.lanePadding + track * L.trackHeight + (L.trackHeight - L.barHeight) / 2
          })
        }
        y += height + L.laneGap
      }
    }
    const emptyY = !isCollapsed && project.emptyLaneIds.length > 0 ? y : null
    if (emptyY !== null) {
      y += L.emptyRow + L.laneGap
    }
    groups.push({
      projectId: project.id,
      y: top,
      height: y - top,
      collapsed: isCollapsed,
      emptyLaneIds: isCollapsed ? [] : project.emptyLaneIds,
      emptyY
    })
    y += L.groupGap
  }
  const width = scale.width + 160
  for (const lane of lanes.values()) {
    lane.width = width
  }
  const { wires, joins, pins } = buildGrowthWires({ tree, scale, lanes, bars })
  const nodes = new Map<string, GrowthBox>()
  for (const lane of lanes.values()) {
    nodes.set(lane.id, lane)
  }
  for (const bar of bars.values()) {
    nodes.set(bar.id, bar)
  }
  return {
    width,
    height: y + L.top,
    scale,
    ticks: growthTreeTicks(scale),
    groups,
    lanes,
    bars,
    joins,
    wires,
    pins,
    paths: { nodes, edges: new Map(wires.map((wire) => [wire.id, wire.path])) }
  }
}
