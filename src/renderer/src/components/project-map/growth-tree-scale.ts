export type GrowthTimeMode = 'compressed' | 'sequence' | 'linear'

export const GROWTH_TIME_MODES: readonly GrowthTimeMode[] = ['compressed', 'sequence', 'linear']

export type GrowthScaleFold = {
  from: number
  to: number
  x: number
  width: number
  /** Opened by the person: this gap is drawn to scale until it is closed again. */
  expanded: boolean
}

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
const EXPANDED_PX_PER_MIN = 1.5
const EXPANDED_MAX_PX = 4_000
const LINEAR_TARGET_PX = 1_600
const LINEAR_MIN_PX_PER_MS = 0.00002
const LINEAR_MAX_PX_PER_MS = 0.2

/** A gap's width grows with the log of its length, so a minute and a day both stay readable. */
export function growthGapWidth(ms: number): number {
  const seconds = Math.max(0, ms) / 1000
  return Math.min(MAX_GAP_PX, MIN_GAP_PX + 18 * Math.log10(1 + seconds))
}

/** The width of a folded gap the person opened: to scale, up to a cap. */
export function growthExpandedWidth(ms: number): number {
  return Math.min(
    EXPANDED_MAX_PX,
    Math.max(FOLD_PX, (Math.max(0, ms) / 60_000) * EXPANDED_PX_PER_MIN)
  )
}

/** Pixels per millisecond of the linear scale: one rate for the whole span. */
export function growthLinearRate(spanMs: number): number {
  if (spanMs <= 0) {
    return LINEAR_MAX_PX_PER_MS
  }
  return Math.min(LINEAR_MAX_PX_PER_MS, Math.max(LINEAR_MIN_PX_PER_MS, LINEAR_TARGET_PX / spanMs))
}

/**
 * Maps moments to x. The order of any two moments is kept: every later moment lands strictly to
 * the right. Compressed time folds a gap over a day to a fixed width unless the person opened it;
 * linear time spends the same width on every millisecond.
 */
export function buildGrowthScale(
  times: readonly number[],
  mode: GrowthTimeMode,
  expandedFolds: ReadonlySet<number> = new Set()
): GrowthScale {
  const distinct = [...new Set(times)].sort((a, b) => a - b)
  const points: { time: number; x: number; index: number }[] = []
  const folds: GrowthScaleFold[] = []
  const first = distinct[0] ?? 0
  const rate = growthLinearRate((distinct.at(-1) ?? first) - first)
  let x = START_X
  distinct.forEach((time, index) => {
    if (index > 0) {
      const previous = distinct[index - 1]!
      const gap = time - previous
      let width: number
      if (mode === 'linear') {
        width = gap * rate
      } else if (mode === 'sequence') {
        width = SEQUENCE_GAP_PX
      } else if (gap > FOLD_AFTER_MS) {
        const expanded = expandedFolds.has(previous)
        width = expanded ? growthExpandedWidth(gap) : FOLD_PX
        folds.push({ from: previous, to: time, x, width, expanded })
      } else {
        width = growthGapWidth(gap)
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
