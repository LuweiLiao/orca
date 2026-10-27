import type { ProjectMapGraph } from './project-map-graph'
import { PROJECT_MAP_GRID, PROJECT_MAP_NODE, type ProjectMapLayout } from './project-map-layout'

/** The cell a dragged-out child chat will occupy: its origin's lane, the column right of it. */
export type ProjectMapDropSlot = {
  row: number
  /** Top-left of the node box, in unscaled content coordinates. */
  x: number
  y: number
}

/**
 * Snaps a drop at content height `pointerY` to the free row of the origin's lane nearest to it.
 * One row past the lane's last is a candidate too, since the lane grows to hold it. Null when
 * every candidate would sit on another node.
 */
export function projectMapDropSlot(
  layout: ProjectMapLayout,
  graph: ProjectMapGraph,
  originId: string,
  pointerY: number
): ProjectMapDropSlot | null {
  const origin = layout.nodes.get(originId)
  const lane = layout.lanes.find(
    (candidate) => candidate.workspaceId === graph.agents.get(originId)?.card.worktreeId
  )
  if (origin?.kind !== 'agent' || !lane) {
    return null
  }
  const { height } = PROJECT_MAP_NODE
  const { row: rowStep, laneInset } = PROJECT_MAP_GRID
  const top = lane.y + laneInset
  const x = origin.x + PROJECT_MAP_GRID.agentColumn
  const rows = Math.round((lane.height - laneInset * 2 - height) / rowStep) + 1
  const nodes = [...layout.nodes.values()]
  let best: ProjectMapDropSlot | null = null
  let bestDistance = Infinity
  for (let row = 0; row <= Math.min(rows, PROJECT_MAP_GRID.maxRow); row++) {
    const y = top + row * rowStep
    const overlaps = nodes.some(
      (node) =>
        node.x < x + PROJECT_MAP_NODE.agentWidth &&
        x < node.x + node.width &&
        node.y < y + height &&
        y < node.y + height
    )
    const distance = Math.abs(y + height / 2 - pointerY)
    if (!overlaps && distance < bestDistance) {
      best = { row, x, y }
      bestDistance = distance
    }
  }
  return best
}
