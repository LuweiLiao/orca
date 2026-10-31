import { buildGrowthPins, growthForkPath, growthRelationPath } from './growth-tree-wires'
import type { GrowthTree } from './growth-tree-types'
import { planGrowthProject } from './growth-tree-rows'
import {
  GROWTH_LANE_COLORS,
  GROWTH_LAYOUT,
  type GrowthBox,
  type GrowthLayout,
  type GrowthLayoutGroup,
  type GrowthLayoutLane,
  type GrowthLayoutRow,
  type GrowthLayoutWire
} from './growth-tree-layout-types'

export * from './growth-tree-layout-types'

export type GrowthLayoutInput = {
  tree: GrowthTree
  /** Project groups drawn as a header only. */
  collapsed: ReadonlySet<string>
  /** Projects drawn; null draws all. */
  projectIds: ReadonlySet<string> | null
  /**
   * What to draw, when that is less than `tree` (a replay's moment). Rows and columns come from
   * `tree`, so nothing moves while the visible set changes.
   */
  shown?: GrowthTree
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export function layoutGrowthTree({
  tree,
  collapsed,
  projectIds,
  shown = tree
}: GrowthLayoutInput): GrowthLayout {
  const L = GROWTH_LAYOUT
  const projects = tree.projects.filter(
    (project) => projectIds === null || projectIds.has(project.id)
  )
  const shownEdges = new Set(shown.edges.map((edge) => edge.id))
  const plans = projects.map((project) => planGrowthProject(tree, project, shown, shownEdges))
  // Every project counts, collapsed or not, so folding one never shifts the text of the others.
  const columnCount = Math.max(
    1,
    ...plans.flatMap((plan) => [...plan.columns.values()].map((c) => c + 1))
  )
  // Room right of the last column for the bows of its relations.
  const graphWidth = Math.max(
    L.minGraphWidth,
    L.graphPadding + (columnCount - 1) * L.column + L.column * 0.9
  )
  const textX = graphWidth + L.textGap
  const xOf = (column: number): number => L.graphPadding + column * L.column

  const groups: GrowthLayoutGroup[] = []
  const lanes = new Map<string, GrowthLayoutLane>()
  const rows = new Map<string, GrowthLayoutRow>()
  const wires: GrowthLayoutWire[] = []
  const centers = new Map<string, { x: number; y: number }>()
  let y: number = L.top
  projects.forEach((project, index) => {
    const { entries, columns, drawn } = plans[index]!
    const isCollapsed = collapsed.has(project.id)
    const top = y
    const bodyTop = y + L.groupHeader
    const rowY = (row: number): number => bodyTop + row * L.rowHeight + L.rowHeight / 2
    if (!isCollapsed) {
      project.laneIds.forEach((laneId, laneIndex) => {
        const span = drawn.extent.get(laneId)
        lanes.set(laneId, {
          id: laneId,
          projectId: project.id,
          column: columns.get(laneId)!,
          color: laneIndex % GROWTH_LANE_COLORS,
          x: xOf(columns.get(laneId)!),
          top: span ? rowY(span.top) : null,
          bottom: span ? rowY(span.bottom) : null
        })
      })
      const tips = new Set<string>()
      entries.forEach((entry, row) => {
        const visible =
          entry.kind === 'chat' ? shown.bars.has(entry.id) : drawn.extent.has(entry.laneId)
        if (!visible) {
          return
        }
        const lane = lanes.get(entry.laneId)!
        const cy = rowY(row)
        const tip = !tips.has(entry.laneId)
        tips.add(entry.laneId)
        rows.set(entry.id, {
          id: entry.id,
          kind: entry.kind,
          laneId: entry.laneId,
          y: bodyTop + row * L.rowHeight,
          cx: lane.x,
          cy,
          tip
        })
        centers.set(entry.id, { x: lane.x, y: cy })
      })
      for (const fork of drawn.forks) {
        const parent = lanes.get(fork.parent)!
        const child = lanes.get(fork.child)!
        wires.push({
          id: fork.edgeId,
          kind: 'derive',
          from: fork.parent,
          to: fork.child,
          projectId: project.id,
          color: child.color,
          path: growthForkPath(
            { x: parent.x, y: rowY(fork.parentRow) },
            { x: child.x, y: rowY(fork.childRow) }
          )
        })
      }
      y = bodyTop + entries.length * L.rowHeight
    } else {
      y = bodyTop
    }
    groups.push({
      projectId: project.id,
      y: top,
      height: y - top,
      collapsed: isCollapsed,
      emptyLaneIds: project.emptyLaneIds
    })
    y += L.groupGap
  })

  for (const edge of shown.edges) {
    const from = centers.get(edge.from)
    const to = centers.get(edge.to)
    if (edge.kind !== 'derive' && from && to) {
      const { id, kind, projectId } = edge
      wires.push({
        id,
        kind,
        from: edge.from,
        to: edge.to,
        projectId,
        path: growthRelationPath(from, to)
      })
    }
  }
  for (const reference of shown.references) {
    const from = centers.get(reference.from)
    const to = centers.get(reference.to)
    if (from && to) {
      wires.push({
        id: reference.id,
        kind: 'reference',
        from: reference.from,
        to: reference.to,
        projectId: reference.projectId,
        path: growthRelationPath(from, to),
        ...(reference.live ? { live: true as const } : {})
      })
    }
  }
  wires.sort((a, b) => cmp(a.id, b.id))

  const r = L.dotRadius
  const nodes = new Map<string, GrowthBox>()
  for (const lane of lanes.values()) {
    if (lane.top !== null && lane.bottom !== null) {
      nodes.set(lane.id, {
        x: lane.x - r,
        y: lane.top,
        width: r * 2,
        height: lane.bottom - lane.top
      })
    }
  }
  for (const row of rows.values()) {
    nodes.set(row.id, {
      x: row.cx - r,
      y: row.cy - r,
      width: r * 2,
      height: r * 2
    })
  }
  return {
    width: textX,
    height: y - L.groupGap + L.top,
    textX,
    groups,
    lanes,
    rows,
    wires,
    pins: buildGrowthPins(
      shown,
      new Set([...rows.values()].filter((row) => row.kind === 'chat').map((row) => row.id))
    ),
    paths: {
      nodes,
      edges: new Map(wires.map((wire) => [wire.id, wire.path])),
      wires
    }
  }
}
