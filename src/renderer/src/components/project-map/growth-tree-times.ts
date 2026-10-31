export type GrowthTimedBar = {
  id: string
  laneId: string
  projectId: string
  /** The card's `startedAt`; 0 or less when unknown. */
  startedAt: number
  /** When the hand-off that made this chat was recorded, a stand-in for a missing start. */
  forkedAt: number | null
}

/** `from` began before `to`: a delegation, hand-off or merge source. */
export type GrowthTimedRelation = { from: string; to: string }

export type GrowthResolvedStart = { start: number; approx: boolean }

const clampTime = (value: number, now: number): number => Math.min(now, Math.max(0, value))

function minOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.min(...values)
}

/**
 * Every chat's start, never in the future and never before its delegator or hand-off source, so a
 * host whose clock runs fast cannot draw a child ahead of its parent. A chat with no recorded
 * start takes its source's, else its workspace's, project's or the earliest known one.
 */
export function resolveGrowthStarts(
  bars: readonly GrowthTimedBar[],
  relations: readonly GrowthTimedRelation[],
  now: number
): Map<string, GrowthResolvedStart> {
  const resolved = new Map<string, GrowthResolvedStart>()
  for (const bar of bars) {
    const known = bar.startedAt > 0 ? bar.startedAt : (bar.forkedAt ?? 0)
    if (known > 0) {
      resolved.set(bar.id, { start: clampTime(known, now), approx: false })
    }
  }
  const sourcesOf = new Map<string, string[]>()
  for (const { from, to } of relations) {
    sourcesOf.set(to, [...(sourcesOf.get(to) ?? []), from])
  }
  const pending = bars.filter((bar) => !resolved.has(bar.id)).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (let progressed = true; progressed;) {
    progressed = false
    for (const bar of pending) {
      const starts = (sourcesOf.get(bar.id) ?? []).flatMap((id) => resolved.get(id)?.start ?? [])
      if (!resolved.has(bar.id) && starts.length > 0) {
        resolved.set(bar.id, { start: Math.max(...starts), approx: true })
        progressed = true
      }
    }
  }
  const known = bars.filter((bar) => resolved.has(bar.id))
  const startsOf = (pick: (bar: GrowthTimedBar) => boolean): number | null =>
    minOf(known.filter(pick).map((bar) => resolved.get(bar.id)!.start))
  const earliest = startsOf(() => true)
  for (const bar of pending) {
    if (!resolved.has(bar.id)) {
      const start =
        startsOf((other) => other.laneId === bar.laneId) ??
        startsOf((other) => other.projectId === bar.projectId) ??
        earliest ??
        now
      resolved.set(bar.id, { start, approx: true })
    }
  }
  for (let pass = 0; pass <= bars.length; pass++) {
    let changed = false
    for (const { from, to } of relations) {
      const source = resolved.get(from)
      const target = resolved.get(to)
      if (source && target && target.start < source.start) {
        resolved.set(to, { ...target, start: source.start })
        changed = true
      }
    }
    if (!changed) {
      break
    }
  }
  return resolved
}

/** A relation's moment, held between its two chats' starts. */
export function clampRelationTime(at: number, fromStart: number, toStart: number): number {
  return Math.min(Math.max(at, fromStart), Math.max(fromStart, toStart))
}
