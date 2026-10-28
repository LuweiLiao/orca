import { PROJECT_MAP_NODE } from './project-map-layout'

export type ProjectMapRect = { x: number; y: number; width: number; height: number }

/**
 * A box a new window should not cover. `window` marks another open window: covering it costs
 * almost nothing next to a node (a click brings it forward), but its header must stay in sight.
 */
export type ProjectMapAvoidRect = ProjectMapRect & { window?: boolean }

const WINDOW_COVER_COST = 0.01
const CASCADE = 36

/** Where an open node window sits among the others, and how it comes to the front. */
export type ProjectMapWindowLayer = { zIndex: number; onRaise: () => void }

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
  avoid: readonly ProjectMapAvoidRect[]
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
      overlapArea(rect, anchor) * 4 +
      avoid.reduce((sum, r) => sum + overlapArea(rect, r) * (r.window ? WINDOW_COVER_COST : 1), 0)
    if (cost < bestCost) {
      best = candidate
      bestCost = cost
    }
  }
  return cascadeOffHeaders(best, avoid, clampX, clampY)
}

/** Steps a window down and right while it would sit on another window's header. */
function cascadeOffHeaders(
  at: { x: number; y: number },
  avoid: readonly ProjectMapAvoidRect[],
  clampX: (x: number) => number,
  clampY: (y: number) => number
): { x: number; y: number } {
  const windows = avoid.filter((rect) => rect.window)
  let next = at
  for (let step = 0; step < windows.length + 1; step++) {
    const onHeader = windows.some(
      (rect) => Math.abs(rect.x - next.x) < CASCADE && Math.abs(rect.y - next.y) < CASCADE
    )
    if (!onHeader) {
      return next
    }
    const moved = { x: clampX(next.x + CASCADE), y: clampY(next.y + CASCADE) }
    if (moved.x === next.x && moved.y === next.y) {
      return next
    }
    next = moved
  }
  return next
}
