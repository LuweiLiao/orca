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

const rankOf = (kind: string): number => {
  const rank = KIND_RANK.indexOf(kind)
  return rank === -1 ? KIND_RANK.length : rank
}

/** The wire a flight from one node to another rides, forwards or, for a report, backwards. */
export function resolveFlowRoute(
  wires: readonly FlowWire[],
  from: string,
  to: string
): FlowRoute | null {
  if (from === to) {
    return null
  }
  let best: { route: FlowRoute; rank: number } | null = null
  for (const wire of wires) {
    if (wire.backward) {
      continue
    }
    const reverse = wire.from === to && wire.to === from
    if (!reverse && !(wire.from === from && wire.to === to)) {
      continue
    }
    const rank = rankOf(wire.kind)
    if (!best || rank < best.rank) {
      best = { route: { path: wire.path, reverse }, rank }
    }
  }
  return best?.route ?? null
}
