import type { FlowRoute } from './project-flow-particles'

export type FlowWire = {
  kind: string
  from: string
  to: string
  path: string
  /** Drawn only beside a selected end, so a flight never rides it. */
  backward?: true
}

// Why: a reference is a pointer, not a route; a delegation or report follows the lineage wire.
const KIND_RANK = ['delegate', 'handoff', 'merge', 'derive', 'reference']
const HANDOFF_KIND_RANK = ['handoff', 'merge', 'delegate', 'derive', 'reference']

const rankOf = (ranking: readonly string[], kind: string): number => {
  const rank = ranking.indexOf(kind)
  return rank === -1 ? ranking.length : rank
}

/**
 * The wire a flight from one node to another rides, forwards or, for a report, backwards. A
 * hand-off prefers a hand-off wire; with none between the two it rides whatever joins them.
 */
export function resolveFlowRoute(
  wires: readonly FlowWire[],
  from: string,
  to: string,
  options: { handoff?: boolean } = {}
): FlowRoute | null {
  if (from === to) {
    return null
  }
  const ranking = options.handoff ? HANDOFF_KIND_RANK : KIND_RANK
  let best: { route: FlowRoute; rank: number } | null = null
  for (const wire of wires) {
    if (wire.backward) {
      continue
    }
    const reverse = wire.from === to && wire.to === from
    if (!reverse && !(wire.from === from && wire.to === to)) {
      continue
    }
    const rank = rankOf(ranking, wire.kind)
    if (!best || rank < best.rank) {
      best = { route: { path: wire.path, reverse }, rank }
    }
  }
  return best?.route ?? null
}
