import {
  parseProjectFlowHistoryPage,
  type ProjectFlowHistoryEntry
} from '../../../../shared/project-flow-history'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  mergeProjectFlowHistories,
  type ProjectFlowTimelineEntry
} from './project-flow-history-timeline'

export type ProjectFlowHistoryHost = { hostId: string; target: RuntimeClientTarget }

/**
 * `unsupported`: the host predates the history, which reads as no history, not as an error.
 * `failed`: it could not be reached. `truncated`: it has more than was read.
 */
export type ProjectFlowHistoryCoverage = 'complete' | 'unsupported' | 'failed' | 'truncated'

export type ProjectFlowTimeline = {
  entries: ProjectFlowTimelineEntry[]
  coverage: Record<string, ProjectFlowHistoryCoverage>
}

export type ProjectFlowHistorySource = {
  supportsHistory: (target: RuntimeClientTarget) => Promise<boolean>
  fetchPage: (
    target: RuntimeClientTarget,
    params: { since?: number; until?: number; cursor?: string }
  ) => Promise<unknown>
}

const MAX_PAGES_PER_HOST = 50

async function readHost(
  host: ProjectFlowHistoryHost,
  source: ProjectFlowHistorySource,
  range: { since?: number; until?: number }
): Promise<{ entries: ProjectFlowHistoryEntry[]; coverage: ProjectFlowHistoryCoverage }> {
  try {
    if (!(await source.supportsHistory(host.target))) {
      return { entries: [], coverage: 'unsupported' }
    }
    const entries: ProjectFlowHistoryEntry[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES_PER_HOST; page += 1) {
      const result = parseProjectFlowHistoryPage(
        await source.fetchPage(host.target, { ...range, ...(cursor ? { cursor } : {}) })
      )
      entries.push(...result.entries)
      if (!result.nextCursor) {
        return { entries, coverage: 'complete' }
      }
      cursor = result.nextCursor
    }
    return { entries, coverage: 'truncated' }
  } catch {
    return { entries: [], coverage: 'failed' }
  }
}

/** Every host's recorded history as one timeline; a host that cannot answer does not stop the rest. */
export async function readProjectFlowTimeline(
  hosts: readonly ProjectFlowHistoryHost[],
  source: ProjectFlowHistorySource,
  range: { since?: number; until?: number } = {}
): Promise<ProjectFlowTimeline> {
  const read = await Promise.all(hosts.map((host) => readHost(host, source, range)))
  return {
    entries: mergeProjectFlowHistories(
      hosts.map((host, index) => ({ hostId: host.hostId, entries: read[index]?.entries ?? [] }))
    ),
    coverage: Object.fromEntries(
      hosts.map((host, index) => [host.hostId, read[index]?.coverage ?? 'failed'])
    )
  }
}
