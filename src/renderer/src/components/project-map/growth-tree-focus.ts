import type { DashboardBucket } from '../../../../shared/dashboard-snapshot'
import type { GrowthTree, GrowthTreeBar, GrowthTreeEdgeKind } from './growth-tree-types'

export type GrowthTimeWindow = 'all' | 'today' | '7d' | '30d'

export type GrowthTreeFilter = {
  /** Empty shows every status. */
  buckets: ReadonlySet<DashboardBucket>
  /** Relation kinds whose lines are not drawn; their chats stay. */
  hiddenKinds: ReadonlySet<GrowthTreeEdgeKind>
  window: GrowthTimeWindow
}

export const GROWTH_EMPTY_FILTER: GrowthTreeFilter = {
  buckets: new Set(),
  hiddenKinds: new Set(),
  window: 'all'
}

const DAY_MS = 24 * 60 * 60 * 1000

export function growthWindowStart(window: GrowthTimeWindow, now: number): number | null {
  switch (window) {
    case 'today': {
      const day = new Date(now)
      day.setHours(0, 0, 0, 0)
      return day.getTime()
    }
    case '7d':
      return now - 7 * DAY_MS
    case '30d':
      return now - 30 * DAY_MS
    case 'all':
      return null
  }
}

export function growthFilterActiveCount(filter: GrowthTreeFilter): number {
  return filter.buckets.size + filter.hiddenKinds.size + (filter.window === 'all' ? 0 : 1)
}

/** A chat the filter does not match is dimmed, never removed, so no line points at nothing. */
export function growthBarMatches(
  bar: GrowthTreeBar,
  filter: GrowthTreeFilter,
  now: number
): boolean {
  if (filter.buckets.size > 0 && !filter.buckets.has(bar.history ? 'idle' : bar.bucket)) {
    return false
  }
  const from = growthWindowStart(filter.window, now)
  return from === null || bar.end >= from
}

export type GrowthFocus = {
  /** The selected node and everything it came from or led to. */
  nodes: ReadonlySet<string>
  edges: ReadonlySet<string>
}

/** Upstream sources and downstream children of a node, through every relation kind. */
export function growthFocus(tree: GrowthTree, selectedId: string | null): GrowthFocus | null {
  if (!selectedId) {
    return null
  }
  const relations = [
    ...tree.edges.map(({ id, from, to }) => ({ id, from, to })),
    ...tree.crossLinks.map(({ id, from, to }) => ({ id, from, to }))
  ]
  const lane = tree.lanes.get(selectedId)
  const seeds = lane ? [selectedId, ...lane.barIds] : [selectedId]
  const nodes = new Set(seeds)
  const edges = new Set<string>()
  for (const direction of ['up', 'down'] as const) {
    const seen = new Set(seeds)
    const queue = [...seeds]
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]!
      for (const relation of relations) {
        const next =
          direction === 'down'
            ? relation.from === current
              ? relation.to
              : null
            : relation.to === current
              ? relation.from
              : null
        if (next !== null) {
          edges.add(relation.id)
          nodes.add(next)
          if (!seen.has(next)) {
            seen.add(next)
            queue.push(next)
          }
        }
      }
    }
  }
  return { nodes, edges }
}
