import type { GrowthScale } from './growth-tree-scale'

/** A ruler mark at a known moment; `index` is its place in the event order. */
export type GrowthTick = { x: number; time: number; index: number }

const MIN_TICK_SPACING_PX = 96

function dayKey(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * Compressed time marks the first moment of each calendar day, and falls back to spaced moments
 * when everything happened in one day. The event order marks spaced moments.
 */
export function growthTreeTicks(scale: GrowthScale): GrowthTick[] {
  const { points, mode } = scale
  const days = new Set(points.map((point) => dayKey(point.time)))
  if (mode !== 'sequence' && days.size > 1) {
    const seen = new Set<string>()
    return points.filter((point) => {
      const key = dayKey(point.time)
      return seen.has(key) ? false : (seen.add(key), true)
    })
  }
  const ticks: GrowthTick[] = []
  for (const point of points) {
    const last = ticks.at(-1)
    if (!last || point.x - last.x >= MIN_TICK_SPACING_PX) {
      ticks.push(point)
    }
  }
  return ticks
}
