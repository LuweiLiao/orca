import type { ProjectMapView } from './use-project-map-viewport'

type Box = { x: number; y: number; width: number; height: number }

const MARGIN = 24

/**
 * How far to pan so a chat is inside the viewport, and not at all when it already is. Only the
 * axis that needs it moves, by the least that brings it in; a chat wider than the viewport lines
 * up on its left edge.
 */
export function growthRevealShift(
  box: Box,
  view: ProjectMapView,
  size: { width: number; height: number }
): { dx: number; dy: number } {
  const axis = (start: number, length: number, offset: number, room: number): number => {
    const from = start * view.zoom + offset
    const to = from + length * view.zoom
    if (length * view.zoom > room - MARGIN * 2) {
      return MARGIN - from
    }
    if (from < MARGIN) {
      return MARGIN - from
    }
    return to > room - MARGIN ? room - MARGIN - to : 0
  }
  return {
    dx: axis(box.x, box.width, view.x, size.width),
    dy: axis(box.y, box.height, view.y, size.height)
  }
}
