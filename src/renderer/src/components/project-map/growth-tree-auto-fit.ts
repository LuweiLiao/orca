import type { ProjectMapView } from './use-project-map-viewport'

// Why: history rows (closed chats, lineage) land a few hundred milliseconds after the tree opens,
// and slower hosts later still; past this the person has had time to start looking around.
export const GROWTH_AUTO_FIT_FOLLOW_MS = 15_000

/** The view an automatic fit produced, when, and under which layout choices (mode, folds). */
export type GrowthAutoFit = { view: ProjectMapView; at: number; choice: string }

export function sameProjectMapView(a: ProjectMapView, b: ProjectMapView): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 1e-4
}

/**
 * Whether a tree that just grew should be fitted again: only right after an automatic fit, while
 * nobody has panned, zoomed, picked a chat or changed the layout (a fold, the time scale), and
 * never during a replay. A wider tree from the person's own layout change is theirs to keep.
 */
export function shouldFollowGrowthAutoFit(input: {
  last: GrowthAutoFit | null
  view: ProjectMapView
  now: number
  selected: boolean
  replaying: boolean
  choice: string
}): boolean {
  const { last, view, now, selected, replaying, choice } = input
  return (
    last !== null &&
    last.choice === choice &&
    !selected &&
    !replaying &&
    now - last.at <= GROWTH_AUTO_FIT_FOLLOW_MS &&
    sameProjectMapView(last.view, view)
  )
}
