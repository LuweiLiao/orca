import { useCallback, useState, useSyncExternalStore } from 'react'

/**
 * Expand/collapse state for a WorktreeCard's inline agent list:
 *  - `collapsedLineageParents`: agent-lineage parent paneKeys the user folded.
 *  - `compactRootListExpanded`: whether the "N agents" compact summary is open.
 *  - `allLineageParentsCollapsed`: set by "Collapse all"; every parent is folded
 *    except the ones in `expandedLineageParents`.
 */
export type WorktreeAgentExpansionState = {
  collapsedLineageParents: ReadonlySet<string>
  compactRootListExpanded: boolean
  allLineageParentsCollapsed?: boolean
  expandedLineageParents?: ReadonlySet<string>
}

const EMPTY_COLLAPSED_PARENTS: ReadonlySet<string> = new Set()

const DEFAULT_EXPANSION_STATE: WorktreeAgentExpansionState = {
  collapsedLineageParents: EMPTY_COLLAPSED_PARENTS,
  compactRootListExpanded: false
}

const BULK_COLLAPSED_STATE: WorktreeAgentExpansionState = {
  collapsedLineageParents: EMPTY_COLLAPSED_PARENTS,
  compactRootListExpanded: false,
  allLineageParentsCollapsed: true
}

const BULK_EXPANDED_STATE: WorktreeAgentExpansionState = {
  collapsedLineageParents: EMPTY_COLLAPSED_PARENTS,
  compactRootListExpanded: true
}

// Why: the sidebar's "Collapse all" must reach cards that are not mounted, so it
// replaces the default every unvisited card reads instead of writing each one.
let bulkDisclosure: { epoch: number; collapsed: boolean | null } = { epoch: 0, collapsed: null }
const bulkListeners = new Set<() => void>()

function subscribeBulkDisclosure(listener: () => void): () => void {
  bulkListeners.add(listener)
  return () => bulkListeners.delete(listener)
}

const readBulkEpoch = (): number => bulkDisclosure.epoch
const readBulkCollapsed = (): boolean | null => bulkDisclosure.collapsed

function currentDefaultState(): WorktreeAgentExpansionState {
  if (bulkDisclosure.collapsed === null) {
    return DEFAULT_EXPANSION_STATE
  }
  return bulkDisclosure.collapsed ? BULK_COLLAPSED_STATE : BULK_EXPANDED_STATE
}

// Why: the inline agent list's expand/collapse must outlive the WorktreeCard
// remount that fires (a) when the sidebar virtualizer recycles the row on
// scroll and (b) when the sibling child-worktrees section toggles — that toggle
// flips the card between an `item` and a `lineage-group` render row, changing
// its virtual-row key and forcing a fresh mount. Holding this in plain local
// useState reset it on every such remount, so folding one section visibly
// re-expanded the other. Renderer-only and LRU-bounded: it resets on reload,
// matching the ephemeral live-agent lineage it tracks, and never grows without
// bound in a long-lived renderer.
export const MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS = 512
const expansionByWorktreeId = new Map<string, WorktreeAgentExpansionState>()

function trimPersistedExpansions(): void {
  while (expansionByWorktreeId.size > MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS) {
    const oldest = expansionByWorktreeId.keys().next().value
    if (oldest === undefined) {
      break
    }
    expansionByWorktreeId.delete(oldest)
  }
}

function readExpansionState(worktreeId: string): WorktreeAgentExpansionState {
  return expansionByWorktreeId.get(worktreeId) ?? currentDefaultState()
}

function isDefaultExpansionState(state: WorktreeAgentExpansionState): boolean {
  const defaults = currentDefaultState()
  return (
    state.compactRootListExpanded === defaults.compactRootListExpanded &&
    (state.allLineageParentsCollapsed ?? false) ===
      (defaults.allLineageParentsCollapsed ?? false) &&
    state.collapsedLineageParents.size === 0 &&
    (state.expandedLineageParents?.size ?? 0) === 0
  )
}

function persistExpansionState(worktreeId: string, state: WorktreeAgentExpansionState): void {
  // Re-insert to refresh LRU order; drop entries that carry no non-default
  // state so idle worktrees never occupy a slot.
  expansionByWorktreeId.delete(worktreeId)
  if (!isDefaultExpansionState(state)) {
    expansionByWorktreeId.set(worktreeId, state)
    trimPersistedExpansions()
  }
}

export function isLineageParentCollapsed(
  state: WorktreeAgentExpansionState,
  paneKey: string
): boolean {
  return state.allLineageParentsCollapsed
    ? !(state.expandedLineageParents?.has(paneKey) ?? false)
    : state.collapsedLineageParents.has(paneKey)
}

/** Collapses (or expands) every card's agent list, including cards not mounted now. */
export function setAllWorktreeAgentListsCollapsed(collapsed: boolean): void {
  expansionByWorktreeId.clear()
  bulkDisclosure = { epoch: bulkDisclosure.epoch + 1, collapsed }
  for (const listener of bulkListeners) {
    listener()
  }
}

/** Null until the user has used "Collapse all" / "Expand all" this session. */
export function useWorktreeAgentListsBulkCollapsed(): boolean | null {
  return useSyncExternalStore(subscribeBulkDisclosure, readBulkCollapsed, readBulkCollapsed)
}

export type WorktreeAgentExpansionControls = {
  isLineageParentCollapsed: (paneKey: string) => boolean
  compactRootListExpanded: boolean
  /** Fold/unfold a single agent-lineage parent by its paneKey. */
  toggleLineageParent: (paneKey: string) => void
  /** Open/close the compact multi-agent summary panel. */
  toggleCompactRootList: () => void
}

function toggledSet(set: ReadonlySet<string> | undefined, key: string): ReadonlySet<string> {
  const next = new Set(set)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  return next
}

/**
 * Remount-durable expand/collapse state for one worktree card's inline agent
 * list. Reads seed from a module-level, session-scoped cache so a virtualizer
 * recycle or a sibling child-worktrees toggle no longer wipes the user's
 * disclosure choices. Independent per worktree id.
 */
export function useWorktreeAgentExpansionState(worktreeId: string): WorktreeAgentExpansionControls {
  const bulkEpoch = useSyncExternalStore(subscribeBulkDisclosure, readBulkEpoch, readBulkEpoch)
  const [rendered, setRendered] = useState<{
    worktreeId: string
    epoch: number
    state: WorktreeAgentExpansionState
  }>(() => ({ worktreeId, epoch: bulkEpoch, state: readExpansionState(worktreeId) }))

  // Why: a memoized body can be handed a new worktreeId without remounting, and
  // "Collapse all" replaces every card's state; fall back to the cache for both.
  const current =
    rendered.worktreeId === worktreeId && rendered.epoch === bulkEpoch
      ? rendered.state
      : readExpansionState(worktreeId)

  const commit = useCallback(
    (next: WorktreeAgentExpansionState) => {
      persistExpansionState(worktreeId, next)
      setRendered({ worktreeId, epoch: bulkDisclosure.epoch, state: next })
    },
    [worktreeId]
  )

  const toggleLineageParent = useCallback(
    (paneKey: string) => {
      const base = readExpansionState(worktreeId)
      commit(
        base.allLineageParentsCollapsed
          ? { ...base, expandedLineageParents: toggledSet(base.expandedLineageParents, paneKey) }
          : { ...base, collapsedLineageParents: toggledSet(base.collapsedLineageParents, paneKey) }
      )
    },
    [commit, worktreeId]
  )

  const toggleCompactRootList = useCallback(() => {
    const base = readExpansionState(worktreeId)
    commit({ ...base, compactRootListExpanded: !base.compactRootListExpanded })
  }, [commit, worktreeId])

  const isParentCollapsed = useCallback(
    (paneKey: string) => isLineageParentCollapsed(current, paneKey),
    [current]
  )

  return {
    isLineageParentCollapsed: isParentCollapsed,
    compactRootListExpanded: current.compactRootListExpanded,
    toggleLineageParent,
    toggleCompactRootList
  }
}

export function clearWorktreeAgentExpansionStateForTests(): void {
  expansionByWorktreeId.clear()
  bulkDisclosure = { epoch: 0, collapsed: null }
}

export function getWorktreeAgentExpansionCountForTests(): number {
  return expansionByWorktreeId.size
}

export function seedWorktreeAgentExpansionStateForTests(
  worktreeId: string,
  state: WorktreeAgentExpansionState
): void {
  persistExpansionState(worktreeId, state)
}
