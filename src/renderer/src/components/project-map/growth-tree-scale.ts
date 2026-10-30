export type GrowthTimeMode = 'compressed' | 'sequence'

export type GrowthScaleFold = { from: number; to: number; x: number; width: number }

export type GrowthScale = {
  mode: GrowthTimeMode
  /** World x of a moment; moments between two known ones are interpolated. */
  xOf: (time: number) => number
  /** Distinct moments in order with their x, for the ruler. */
  points: readonly { time: number; x: number; index: number }[]
  folds: readonly GrowthScaleFold[]
  width: number
}

const START_X = 24
const MIN_GAP_PX = 28
const MAX_GAP_PX = 140
const SEQUENCE_GAP_PX = 56
const FOLD_AFTER_MS = 24 * 60 * 60 * 1000
const FOLD_PX = 44

/** A gap's width grows with the log of its length, so a minute and a day both stay readable. */
export function growthGapWidth(ms: number): number {
  const seconds = Math.max(0, ms) / 1000
  return Math.min(MAX_GAP_PX, MIN_GAP_PX + 18 * Math.log10(1 + seconds))
}

/**
 * Maps moments to x. The order of any two moments is kept: every later moment lands strictly to
 * the right, and a gap longer than a day folds to a fixed width instead of a proportional one.
 */
export function buildGrowthScale(times: readonly number[], mode: GrowthTimeMode): GrowthScale {
  const distinct = [...new Set(times)].sort((a, b) => a - b)
  const points: { time: number; x: number; index: number }[] = []
  const folds: GrowthScaleFold[] = []
  let x = START_X
  distinct.forEach((time, index) => {
    if (index > 0) {
      const gap = time - distinct[index - 1]!
      const folded = mode === 'compressed' && gap > FOLD_AFTER_MS
      const width = mode === 'sequence' ? SEQUENCE_GAP_PX : folded ? FOLD_PX : growthGapWidth(gap)
      if (folded) {
        folds.push({ from: distinct[index - 1]!, to: time, x, width })
      }
      x += width
    }
    points.push({ time, x, index })
  })
  const xOf = (time: number): number => {
    if (points.length === 0 || time <= points[0]!.time) {
      return START_X
    }
    let low = 0
    let high = points.length - 1
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if (points[middle]!.time <= time) {
        low = middle
      } else {
        high = middle
      }
    }
    const a = points[low]!
    const b = points[high]!
    if (time >= b.time) {
      return b.x
    }
    return a.x + ((time - a.time) / (b.time - a.time)) * (b.x - a.x)
  }
  return { mode, xOf, points, folds, width: x }
}
