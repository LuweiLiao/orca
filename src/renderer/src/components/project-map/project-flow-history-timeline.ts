import type { ProjectFlowHistoryEntry } from '../../../../shared/project-flow-history'

export type ProjectFlowHistoryOfHost = {
  hostId: string
  entries: readonly ProjectFlowHistoryEntry[]
}

export type ProjectFlowTimelineEntry = ProjectFlowHistoryEntry & { hostId: string }

function bySeq(entries: readonly ProjectFlowHistoryEntry[]): ProjectFlowHistoryEntry[] {
  const unique = new Map(entries.map((entry) => [entry.seq, entry]))
  return [...unique.values()].sort((a, b) => a.seq - b.seq)
}

/**
 * One timeline from several hosts. Each host keeps its own seq order, which is the order it
 * recorded things in; across hosts the clocks decide, then the host id, then seq, so the same
 * input always gives the same output. A host whose clock runs behind never reorders its own rows.
 */
export function mergeProjectFlowHistories(
  hosts: readonly ProjectFlowHistoryOfHost[]
): ProjectFlowTimelineEntry[] {
  const lanes = new Map<string, ProjectFlowHistoryEntry[]>()
  for (const host of hosts) {
    lanes.set(host.hostId, bySeq([...(lanes.get(host.hostId) ?? []), ...host.entries]))
  }
  const heads = new Map([...lanes.keys()].map((hostId) => [hostId, 0]))
  const merged: ProjectFlowTimelineEntry[] = []
  for (;;) {
    let next: ProjectFlowTimelineEntry | null = null
    for (const [hostId, lane] of lanes) {
      const entry = lane[heads.get(hostId) ?? 0]
      if (!entry) {
        continue
      }
      if (
        !next ||
        entry.occurredAt < next.occurredAt ||
        (entry.occurredAt === next.occurredAt &&
          (hostId < next.hostId || (hostId === next.hostId && entry.seq < next.seq)))
      ) {
        next = { ...entry, hostId }
      }
    }
    if (!next) {
      return merged
    }
    merged.push(next)
    heads.set(next.hostId, (heads.get(next.hostId) ?? 0) + 1)
  }
}
