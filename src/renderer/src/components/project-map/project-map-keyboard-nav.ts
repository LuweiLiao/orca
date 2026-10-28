import { PROJECT_MAP_NODE, type ProjectMapNodeBox } from './project-map-layout'
import type { ProjectMapView } from './use-project-map-viewport'

export type ProjectMapArrow = 'left' | 'right' | 'up' | 'down'

const center = (box: ProjectMapNodeBox): { x: number; y: number } => ({
  x: box.x + box.width / 2,
  y: box.y + PROJECT_MAP_NODE.height / 2
})

/**
 * The node an arrow key moves to: the closest one strictly in that direction, with sideways
 * drift counting double so a key follows its row or column. From nothing, the top-left node.
 */
export function projectMapNearestNode(
  nodes: Iterable<ProjectMapNodeBox>,
  fromId: string | null,
  arrow: ProjectMapArrow
): string | null {
  const all = [...nodes]
  const from = all.find((box) => box.id === fromId)
  if (!from) {
    const first = all.reduce<ProjectMapNodeBox | null>(
      (best, box) => (!best || box.y + box.x * 0.001 < best.y + best.x * 0.001 ? box : best),
      null
    )
    return first?.id ?? null
  }
  const origin = center(from)
  let best: { id: string; score: number } | null = null
  for (const box of all) {
    if (box.id === from.id) {
      continue
    }
    const point = center(box)
    const dx = point.x - origin.x
    const dy = point.y - origin.y
    const along = arrow === 'left' ? -dx : arrow === 'right' ? dx : arrow === 'up' ? -dy : dy
    const across = arrow === 'left' || arrow === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 0) {
      continue
    }
    const score = along + across * 2
    if (!best || score < best.score) {
      best = { id: box.id, score }
    }
  }
  return best?.id ?? null
}

/** Whether a node sits fully inside the viewport, with a margin so it is not flush to an edge. */
export function projectMapNodeInView(
  box: ProjectMapNodeBox,
  view: ProjectMapView,
  size: { width: number; height: number },
  margin = 24
): boolean {
  const left = box.x * view.zoom + view.x
  const top = box.y * view.zoom + view.y
  const right = left + box.width * view.zoom
  const bottom = top + PROJECT_MAP_NODE.height * view.zoom
  return (
    left >= margin &&
    top >= margin &&
    right <= size.width - margin &&
    bottom <= size.height - margin
  )
}
