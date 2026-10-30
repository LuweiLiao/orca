import type { GrowthLayout, GrowthLayoutRow } from './growth-tree-layout'
import type { ProjectMapArrow } from './project-map-keyboard-nav'

const byPlace = (a: GrowthLayoutRow, b: GrowthLayoutRow): number =>
  a.cy - b.cy || a.cx - b.cx || (a.id < b.id ? -1 : 1)

/**
 * The row an arrow key moves to. Up and down step through the rows as drawn; left and right move
 * to the nearest row in the next column over. From nothing, the top row.
 */
export function growthNearestRow(
  layout: GrowthLayout,
  fromId: string | null,
  arrow: ProjectMapArrow
): string | null {
  const rows = [...layout.rows.values()].sort(byPlace)
  const from = fromId ? layout.rows.get(fromId) : undefined
  if (!from) {
    return rows[0]?.id ?? null
  }
  if (arrow === 'up' || arrow === 'down') {
    const index = rows.findIndex((row) => row.id === from.id)
    return rows[index + (arrow === 'down' ? 1 : -1)]?.id ?? null
  }
  const side = rows.filter((row) => (arrow === 'right' ? row.cx > from.cx : row.cx < from.cx))
  const column = side.reduce<number | null>(
    (best, row) =>
      best === null || Math.abs(row.cx - from.cx) < Math.abs(best - from.cx) ? row.cx : best,
    null
  )
  const closest = side
    .filter((row) => row.cx === column)
    .sort((a, b) => Math.abs(a.cy - from.cy) - Math.abs(b.cy - from.cy) || byPlace(a, b))[0]
  return closest?.id ?? null
}

/** How far to scroll so a row is in view with a margin; 0 when it already is. */
export function growthScrollToRow(
  row: Pick<GrowthLayoutRow, 'y'>,
  rowHeight: number,
  scroll: { top: number; height: number },
  margin = 24
): number {
  const top = row.y - margin
  const bottom = row.y + rowHeight + margin
  if (top < scroll.top) {
    return top - scroll.top
  }
  if (bottom > scroll.top + scroll.height) {
    return Math.min(top - scroll.top, bottom - scroll.top - scroll.height)
  }
  return 0
}
