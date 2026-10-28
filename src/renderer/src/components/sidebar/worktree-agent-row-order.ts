import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { DEFAULT_WORKTREE_AGENT_ORDER } from '../../../../shared/constants'
import type { WorktreeAgentOrder } from '../../../../shared/ui-chrome-types'

function comparableNumber(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function comparePaneKeysOrdinal(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}

export function compareWorktreeAgentRows(a: DashboardAgentRow, b: DashboardAgentRow): number {
  return (
    comparableNumber(a.startedAt) - comparableNumber(b.startedAt) ||
    comparableNumber(a.tab.sortOrder) - comparableNumber(b.tab.sortOrder) ||
    comparableNumber(a.tab.createdAt) - comparableNumber(b.tab.createdAt) ||
    comparePaneKeysOrdinal(a.paneKey, b.paneKey)
  )
}

// Why state/turn stamps, not updatedAt: tool pings bump updatedAt every few seconds and would reshuffle the list.
function lastAgentActivityAt(row: DashboardAgentRow): number {
  return Math.max(
    comparableNumber(row.startedAt),
    comparableNumber(row.entry.stateStartedAt),
    comparableNumber(row.entry.turnStartedAt),
    comparableNumber(row.entry.turnEndedAt)
  )
}

/** Reorders rows already sorted by compareWorktreeAgentRows; the lineage tree keeps this order among siblings. */
export function orderWorktreeAgentRows(
  rows: readonly DashboardAgentRow[],
  order: WorktreeAgentOrder = DEFAULT_WORKTREE_AGENT_ORDER
): readonly DashboardAgentRow[] {
  if (order === 'oldest' || rows.length < 2) {
    return rows
  }
  const newestFirst = (a: DashboardAgentRow, b: DashboardAgentRow): number =>
    compareWorktreeAgentRows(b, a)
  if (order === 'newest') {
    return rows.toSorted(newestFirst)
  }
  return rows.toSorted(
    (a, b) => lastAgentActivityAt(b) - lastAgentActivityAt(a) || newestFirst(a, b)
  )
}
