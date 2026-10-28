import {
  agentSessionLineageSources,
  type AgentSessionForkCut,
  type AgentSessionLineageEntry
} from '../../../../shared/agent-session-fork'

/** Where a chat left the common one: the cut it (or the chat it came through) was handed. */
type Branch = { sessionId: string; cut: AgentSessionForkCut }

export type ProjectMapBranchRelation =
  | { kind: 'unrelated' }
  /** `ancestor` is one of the two; `descendant` was handed it through `cut`. */
  | { kind: 'ancestor'; ancestor: string; descendant: string; cut: AgentSessionForkCut }
  /** Neither came from the other: both were handed `common`, each at its own cut. */
  | { kind: 'siblings'; common: string; cuts: Record<string, AgentSessionForkCut> }

const MAX_DEPTH = 64

/** Every chat a session was handed from, nearest first, with the cut that left it. */
function ancestors(
  sessionId: string,
  lineageOf: (childSessionId: string) => AgentSessionLineageEntry | undefined
): Map<string, Branch> {
  const found = new Map<string, Branch>()
  let wave: string[] = [sessionId]
  for (let depth = 0; depth < MAX_DEPTH && wave.length > 0; depth++) {
    const next: string[] = []
    for (const child of wave) {
      const entry = lineageOf(child)
      // A merge was handed every one of its sources.
      for (const source of entry ? agentSessionLineageSources(entry) : []) {
        if (source.sessionId !== sessionId && !found.has(source.sessionId)) {
          found.set(source.sessionId, { sessionId: source.sessionId, cut: source.cut })
          next.push(source.sessionId)
        }
      }
    }
    wave = next
  }
  return found
}

/**
 * How two chats on the map are related through hand-offs: one handed from the other, both from
 * a common chat, or neither. The nearest common chat wins.
 */
export function projectMapBranchRelation(
  a: string,
  b: string,
  lineageOf: (childSessionId: string) => AgentSessionLineageEntry | undefined
): ProjectMapBranchRelation {
  const fromA = ancestors(a, lineageOf)
  const fromB = ancestors(b, lineageOf)
  const aInB = fromB.get(a)
  if (aInB) {
    return { kind: 'ancestor', ancestor: a, descendant: b, cut: aInB.cut }
  }
  const bInA = fromA.get(b)
  if (bInA) {
    return { kind: 'ancestor', ancestor: b, descendant: a, cut: bInA.cut }
  }
  // Insertion order is nearest first, so the first shared one is the closest.
  for (const [common, branchA] of fromA) {
    const branchB = fromB.get(common)
    if (branchB) {
      return { kind: 'siblings', common, cuts: { [a]: branchA.cut, [b]: branchB.cut } }
    }
  }
  return { kind: 'unrelated' }
}

/** The turns, in order, of a chat's outline that lie after a cut made in the same history. */
export function projectMapTurnsAfterCut<T extends { sequence: number }>(
  turns: readonly T[],
  cut: AgentSessionForkCut,
  epoch: string
): T[] | null {
  // A rewind since the cut leaves no shared history to line up against.
  if (cut.journalEpoch !== epoch) {
    return null
  }
  return turns.filter((turn) => turn.sequence > cut.journalSequence)
}
