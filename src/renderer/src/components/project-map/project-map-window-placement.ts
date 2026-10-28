import { PROJECT_MAP_NODE } from './project-map-layout'

export type ProjectMapRect = { x: number; y: number; width: number; height: number }

/** A node-sized box on the content, where it shows in the viewport at the current pan and zoom. */
export function projectMapViewportRect(
  box: { x: number; y: number; width: number },
  view: { x: number; y: number; zoom: number }
): ProjectMapRect {
  return {
    x: box.x * view.zoom + view.x,
    y: box.y * view.zoom + view.y,
    width: box.width * view.zoom,
    height: PROJECT_MAP_NODE.height * view.zoom
  }
}

/** Where a placed, not yet created, child shows: its header pin sits on the dropped point. */
export function projectMapDraftRect(
  point: { x: number; y: number },
  view: { x: number; y: number; zoom: number }
): ProjectMapRect {
  return projectMapViewportRect(
    {
      x: point.x,
      y: point.y - PROJECT_MAP_NODE.headerPinOffsetY,
      width: PROJECT_MAP_NODE.agentWidth
    },
    view
  )
}

const GAP = 14
const EDGE = 8

function overlapArea(a: ProjectMapRect, b: ProjectMapRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/**
 * Opens the window beside its node on whichever side covers the least of the nodes wired to it,
 * so the relation being inspected stays visible. Falls back to the right edge when nothing fits.
 */
export function placeProjectMapWindow(
  anchor: ProjectMapRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  avoid: readonly ProjectMapRect[]
): { x: number; y: number } {
  const height = Math.min(size.height, viewport.height - EDGE * 2)
  const clampX = (x: number): number =>
    Math.max(EDGE, Math.min(x, viewport.width - size.width - EDGE))
  const clampY = (y: number): number => Math.max(EDGE, Math.min(y, viewport.height - height - EDGE))
  const candidates = [
    { x: anchor.x + anchor.width + GAP, y: clampY(anchor.y - 6) },
    { x: anchor.x - GAP - size.width, y: clampY(anchor.y - 6) },
    { x: clampX(anchor.x), y: anchor.y + anchor.height + GAP },
    { x: clampX(anchor.x), y: anchor.y - GAP - height }
  ].filter(
    ({ x, y }) =>
      x >= EDGE &&
      y >= EDGE &&
      x + size.width <= viewport.width - EDGE &&
      y + height <= viewport.height - EDGE
  )
  let best = { x: clampX(viewport.width - size.width - EDGE), y: clampY(anchor.y) }
  let bestCost = Infinity
  for (const candidate of candidates) {
    const rect = { ...candidate, width: size.width, height }
    const cost =
      overlapArea(rect, anchor) * 4 + avoid.reduce((sum, r) => sum + overlapArea(rect, r), 0)
    if (cost < bestCost) {
      best = candidate
      bestCost = cost
    }
  }
  return best
}
