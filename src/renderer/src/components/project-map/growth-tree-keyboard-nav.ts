import type { GrowthLayout, GrowthLayoutBar } from './growth-tree-layout'
import type { ProjectMapArrow } from './project-map-keyboard-nav'
import type { ProjectMapView } from './use-project-map-viewport'

const byPlace = (a: GrowthLayoutBar, b: GrowthLayoutBar): number =>
  a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : 1)

/**
 * The chat an arrow key moves to. Left and right step through the lane's chats in time order;
 * up and down move to the nearest lane above or below that has chats, landing on the chat there
 * closest in time. From nothing, the first chat in the top lane.
 */
export function growthNearestBar(
  layout: GrowthLayout,
  fromId: string | null,
  arrow: ProjectMapArrow
): string | null {
  const bars = [...layout.bars.values()]
  const from = fromId ? layout.bars.get(fromId) : undefined
  if (!from) {
    const first = [...bars].sort((a, b) => a.y - b.y || byPlace(a, b))[0]
    return first?.id ?? null
  }
  if (arrow === 'left' || arrow === 'right') {
    const lane = bars.filter((bar) => bar.laneId === from.laneId).sort(byPlace)
    const index = lane.findIndex((bar) => bar.id === from.id)
    return lane[index + (arrow === 'right' ? 1 : -1)]?.id ?? null
  }
  const laneY = (laneId: string): number => layout.lanes.get(laneId)?.y ?? 0
  const here = laneY(from.laneId)
  const lanes = [...new Set(bars.map((bar) => bar.laneId))]
    .filter((laneId) => (arrow === 'down' ? laneY(laneId) > here : laneY(laneId) < here))
    .sort((a, b) => (arrow === 'down' ? laneY(a) - laneY(b) : laneY(b) - laneY(a)))
  const next = lanes[0]
  if (!next) {
    return null
  }
  const candidates = bars.filter((bar) => bar.laneId === next)
  const closest = candidates.sort(
    (a, b) => Math.abs(a.x - from.x) - Math.abs(b.x - from.x) || byPlace(a, b)
  )[0]
  return closest?.id ?? null
}

/** Whether a chat sits inside the viewport with a margin, so a key can scroll one in. */
export function growthBarInView(
  bar: GrowthLayoutBar,
  view: ProjectMapView,
  size: { width: number; height: number },
  margin = 24
): boolean {
  const left = bar.x * view.zoom + view.x
  const top = bar.y * view.zoom + view.y
  return (
    left >= margin &&
    top >= margin &&
    left + bar.width * view.zoom <= size.width - margin &&
    top + bar.height * view.zoom <= size.height - margin
  )
}
