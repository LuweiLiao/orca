import type { GitGraphOptions } from '../../../../shared/git-graph-types'
import type { GitHistoryItemRef } from '../../../../shared/git-history-types'

/** UI selection state for the toolbar branch filter; `refIds` is only meaningful in 'selected' mode. */
export type GitGraphBranchFilter =
  | { mode: 'all' }
  | { mode: 'head' }
  | { mode: 'selected'; refIds: readonly string[] }

export const ALL_BRANCHES_FILTER: GitGraphBranchFilter = { mode: 'all' }
export const CURRENT_BRANCH_FILTER: GitGraphBranchFilter = { mode: 'head' }

/** Toggling a ref on/off; selecting from All/Current switches to a single-ref selection. */
export function toggleGitGraphFilterRef(
  filter: GitGraphBranchFilter,
  refId: string
): GitGraphBranchFilter {
  if (filter.mode !== 'selected') {
    return { mode: 'selected', refIds: [refId] }
  }
  if (filter.refIds.includes(refId)) {
    const next = filter.refIds.filter((id) => id !== refId)
    // Why: 0-selected is never shown; deselecting the last ref falls back to All branches.
    return next.length === 0 ? ALL_BRANCHES_FILTER : { mode: 'selected', refIds: next }
  }
  return { mode: 'selected', refIds: [...filter.refIds, refId] }
}

/** Drops selected refs that no longer resolve; empties out to All branches. */
export function pruneGitGraphFilterRefs(
  filter: GitGraphBranchFilter,
  missingRefIds: ReadonlySet<string>
): GitGraphBranchFilter {
  if (filter.mode !== 'selected' || missingRefIds.size === 0) {
    return filter
  }
  const next = filter.refIds.filter((id) => !missingRefIds.has(id))
  if (next.length === filter.refIds.length) {
    return filter
  }
  return next.length === 0 ? ALL_BRANCHES_FILTER : { mode: 'selected', refIds: next }
}

/**
 * Drops selected refs that belong to the remote-branches category once that group is hidden.
 * `refsById` only needs to cover refs the filter might reference (knownRefs is enough).
 */
export function pruneGitGraphFilterRemoteRefs(
  filter: GitGraphBranchFilter,
  refsById: ReadonlyMap<string, GitHistoryItemRef>
): GitGraphBranchFilter {
  if (filter.mode !== 'selected') {
    return filter
  }
  const remoteIds = new Set(
    filter.refIds.filter((id) => refsById.get(id)?.category === 'remote branches')
  )
  return pruneGitGraphFilterRefs(filter, remoteIds)
}

/** Maps the UI filter + remote-branches toggle to the wire-level request options. */
export function gitGraphFilterToOptions(
  filter: GitGraphBranchFilter,
  showRemoteBranches: boolean
): { scope: NonNullable<GitGraphOptions['scope']>; refs?: GitGraphOptions['refs'] } {
  if (filter.mode === 'head') {
    return { scope: 'head' }
  }
  if (filter.mode === 'selected') {
    return { scope: 'refs', refs: [...filter.refIds] }
  }
  return { scope: showRemoteBranches ? 'all' : 'local' }
}
