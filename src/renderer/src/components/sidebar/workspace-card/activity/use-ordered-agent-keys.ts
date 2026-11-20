import { useCallback, useRef } from 'react'
import { useAppStore } from '@/store/index'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { orderWorktreeAgentRows } from './worktree-agent-row-order'
import { useAgentPresentation } from './useWorktreeAgentRows'

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

/**
 * The keys in the order the workspace's agent-order setting asks for. The projection keeps its
 * canonical oldest-first order, so siblings are reordered here and children stay under their parent.
 */
export function useOrderedAgentKeys(
  worktreeId: string,
  keys: readonly string[]
): readonly string[] {
  const order = useAppStore((s) => s.worktreeAgentOrder)
  const previous = useRef<readonly string[]>(keys)
  // Every row change in the workspace notifies its list channel, which is what the order reads.
  const read = useCallback(
    (projection: { row: (key: string) => DashboardAgentRow | undefined }) => {
      const rows: DashboardAgentRow[] = []
      for (const key of keys) {
        const row = projection.row(key)
        if (row) {
          rows.push(row)
        }
      }
      const next =
        rows.length === keys.length
          ? orderWorktreeAgentRows(rows, order).map((row) => row.paneKey)
          : keys
      if (sameKeys(previous.current, next)) {
        return previous.current
      }
      previous.current = next
      return next
    },
    [keys, order]
  )
  return useAgentPresentation(`list\0${worktreeId}`, read)
}
