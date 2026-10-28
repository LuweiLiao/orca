import type { ProjectMapEdge } from './project-map-graph'
import { PROJECT_MAP_NODE, type ProjectMapNodeBox, type ProjectMapWire } from './project-map-layout'

/**
 * A wire per edge between drawn nodes. Tree edges always point right. References and a merge's
 * extra sources do not shape the columns, so they may meet a node in the same column (an arc on
 * the right) or come from its right (a loop, drawn only while either end is selected).
 */
export function projectMapWires(
  edges: readonly ProjectMapEdge[],
  nodes: ReadonlyMap<string, ProjectMapNodeBox>
): ProjectMapWire[] {
  return edges.flatMap((edge): ProjectMapWire[] => {
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) {
      return []
    }
    if (edge.kind === 'reference' || edge.kind === 'merge') {
      const pinY =
        edge.kind === 'merge'
          ? PROJECT_MAP_NODE.headerPinOffsetY
          : PROJECT_MAP_NODE.referencePinOffsetY
      const y0 = from.y + pinY
      const y1 = to.y + pinY
      const x0 = from.x + from.width
      if (x0 < to.x) {
        return [{ ...edge, path: wirePath(x0, y0, to.x, y1) }]
      }
      if (from.x === to.x) {
        const x1 = to.x + to.width
        const bulge = 36
        return [
          {
            ...edge,
            path: `M${x0} ${y0} C${x0 + bulge} ${y0} ${x1 + bulge} ${y1} ${x1} ${y1}`,
            side: true
          }
        ]
      }
      return [{ ...edge, path: loopPath(x0, y0, to.x, y1), backward: true }]
    }
    const pinY =
      edge.kind === 'handoff' ? PROJECT_MAP_NODE.headerPinOffsetY : PROJECT_MAP_NODE.pinOffsetY
    return [{ ...edge, path: wirePath(from.x + from.width, from.y + pinY, to.x, to.y + pinY) }]
  })
}

/** Horizontal tangents capped at dx keep x monotonic, so a wire stays inside its gutter. */
export function wirePath(x0: number, y0: number, x1: number, y1: number): string {
  const k = Math.max(12, Math.min(Math.abs(x1 - x0) * 0.75, 160))
  return `M${x0} ${y0} C${x0 + k} ${y0} ${x1 - k} ${y1} ${x1} ${y1}`
}

/** Leaves rightward and enters from the left, so a backward wire still reads source to target. */
function loopPath(x0: number, y0: number, x1: number, y1: number): string {
  return `M${x0} ${y0} C${x0 + 140} ${y0} ${x1 - 140} ${y1} ${x1} ${y1}`
}
