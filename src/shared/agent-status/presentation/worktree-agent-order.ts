import type { WorktreeAgentOrder } from '../../ui-chrome/ui-chrome-types'

export const DEFAULT_WORKTREE_AGENT_ORDER: WorktreeAgentOrder = 'activity'

export function normalizeWorktreeAgentOrder(value: unknown): WorktreeAgentOrder {
  return value === 'activity' || value === 'newest' || value === 'oldest'
    ? value
    : DEFAULT_WORKTREE_AGENT_ORDER
}
