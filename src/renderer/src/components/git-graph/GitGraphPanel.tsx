import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { getKnownGitHead } from '@/store/slices/editor/git/branch-compare-state'
import { translate } from '@/i18n/i18n'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import type { GitHistoryItem, GitHistoryItemRef } from '../../../../shared/git-history-types'
import { buildGitGraphViewModels } from '../../../../shared/git-history-graph'
import { useGitHistoryCommitActions } from '../right-sidebar/source-control/sync/use-git-history-commit-actions'
import {
  isSourceControlSplitOpenModifier,
  type SourceControlRowOpenEvent
} from '../right-sidebar/source-control/listing/split-open'
import { useGitGraphOwner } from './use-git-graph-owner'
import type { OpenFile } from '@/store/slices/editor'
import { useGitGraphHistory } from './use-git-graph-history'
import { useGitGraphCommitFiles } from './use-git-graph-commit-files'
import {
  buildGitGraphColorMap,
  findGitGraphMatchIndexes,
  getGitGraphHeadRef,
  stepGitGraphMatch
} from './git-graph-model'
import {
  ALL_BRANCHES_FILTER,
  gitGraphFilterToOptions,
  pruneGitGraphFilterRefs,
  pruneGitGraphFilterRemoteRefs,
  toggleGitGraphFilterRef,
  type GitGraphBranchFilter
} from './git-graph-branch-filter'
import { useGitGraphShowRemoteBranches } from './use-git-graph-show-remote-branches'
import { GitGraphToolbar } from './git-graph-toolbar'
import { GitGraphCommitList, type GitGraphCommitListHandle } from './git-graph-commit-list'
import { GitGraphCommitDetail } from './git-graph-commit-detail'
import {
  GitGraphOwnerMessage,
  GitGraphStatusBar,
  renderGitGraphHistoryMessage
} from './git-graph-panel-messages'

// Why: mirrors the graph SVG's 11px lane pitch so every row reserves the same graph column.
const GRAPH_LANE_WIDTH = 11
const MAX_GRAPH_COLUMN_WIDTH = 264

function mergeKnownRefs(
  previous: readonly GitHistoryItemRef[],
  incoming: readonly GitHistoryItemRef[]
): GitHistoryItemRef[] {
  const byId = new Map(previous.map((ref) => [ref.id, ref]))
  for (const ref of incoming) {
    byId.set(ref.id, ref)
  }
  return [...byId.values()]
}

function useGitGraphSplitTarget(
  worktreeId: string,
  isMac: boolean
): (event?: SourceControlRowOpenEvent) => string | undefined {
  // Why: modifier-click opens the file in a fresh split, matching the Source Control rows.
  return useCallback(
    (event?: SourceControlRowOpenEvent): string | undefined => {
      if (!event || !isSourceControlSplitOpenModifier(event, isMac)) {
        return undefined
      }
      const store = useAppStore.getState()
      const sourceGroupId =
        store.activeGroupIdByWorktree[worktreeId] ?? store.groupsByWorktree[worktreeId]?.[0]?.id
      return sourceGroupId
        ? (store.createEmptySplitGroup(worktreeId, sourceGroupId, 'right') ?? undefined)
        : undefined
    },
    [isMac, worktreeId]
  )
}

function GitGraphReadyView({
  context,
  ownerKey,
  resolveContext
}: {
  context: RuntimeGitContext & { worktreeId: string }
  ownerKey: string
  resolveContext: () => RuntimeGitContext
}): React.JSX.Element {
  const listId = useId()
  const worktreeId = context.worktreeId
  const [filter, setFilter] = useState<GitGraphBranchFilter>(ALL_BRANCHES_FILTER)
  const [showRemoteBranches, setShowRemoteBranches] = useGitGraphShowRemoteBranches()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(true)
  const [knownRefs, setKnownRefs] = useState<GitHistoryItemRef[]>([])
  const listRef = useRef<GitGraphCommitListHandle>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { scope, refs: requestedRefs } = gitGraphFilterToOptions(filter, showRemoteBranches)
  const { state, refresh, loadMore } = useGitGraphHistory({
    ownerKey,
    resolveContext,
    scope,
    refs: requestedRefs
  })
  const result = state.result
  const items = useMemo(() => result?.items ?? [], [result])

  // Why: a commit, checkout or reset in a terminal moves HEAD; refresh so the graph is not stale.
  const statusHead = useAppStore((s) => getKnownGitHead(s.gitStatusHeadByWorktree[worktreeId]))
  const staleHeadRef = useRef({ refresh, loadedHead: result?.headOid, ready: false })
  useEffect(() => {
    staleHeadRef.current = {
      refresh,
      loadedHead: result?.headOid,
      ready: state.status === 'ready' && !state.refreshing
    }
  }, [refresh, result?.headOid, state.refreshing, state.status])
  useEffect(() => {
    const { refresh: refreshGraph, loadedHead, ready } = staleHeadRef.current
    if (statusHead && loadedHead && ready && statusHead !== loadedHead) {
      refreshGraph()
    }
  }, [statusHead])

  useEffect(() => {
    if (!result) {
      return
    }
    // Why: a narrowed scope lists fewer refs; keep earlier choices available in the picker.
    setKnownRefs((previous) =>
      result.scope === 'all' ? result.refs : mergeKnownRefs(previous, result.refs)
    )
  }, [result])
  const refsById = useMemo(() => new Map(knownRefs.map((ref) => [ref.id, ref])), [knownRefs])

  // Why: computed during render (not an effect) so the toolbar never flashes a selection the
  // result just reported missing; the effect below only commits it back into state once.
  const missingRefs = result?.missingRefs
  const prunedFilter = useMemo(
    () => (missingRefs?.length ? pruneGitGraphFilterRefs(filter, new Set(missingRefs)) : filter),
    [filter, missingRefs]
  )
  useEffect(() => {
    if (!missingRefs || missingRefs.length === 0) {
      return
    }
    // Why: prunedFilter above already derives this render's stale-free value; this only commits
    // it into state once so the next toggle reuses a clean refIds instead of a rejected one.
    // oxlint-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setFilter((previous) => pruneGitGraphFilterRefs(previous, new Set(missingRefs)))
    toast.info(
      translate(
        'auto.components.gitGraph.filter.missingRefs',
        'Some selected branches no longer exist'
      )
    )
  }, [missingRefs])

  const filteredRefIds = useMemo(
    () => (prunedFilter.mode === 'selected' ? new Set(prunedFilter.refIds) : undefined),
    [prunedFilter]
  )

  const handleFilterChange = useCallback((next: GitGraphBranchFilter) => setFilter(next), [])
  const handleToggleFilterRef = useCallback(
    (refId: string) => setFilter((previous) => toggleGitGraphFilterRef(previous, refId)),
    []
  )
  const handleShowRemoteBranchesChange = useCallback(
    (next: boolean) => {
      setShowRemoteBranches(next)
      if (!next) {
        setFilter((previous) => pruneGitGraphFilterRemoteRefs(previous, refsById))
      }
    },
    [refsById, setShowRemoteBranches]
  )

  const viewModels = useMemo(
    () =>
      result
        ? buildGitGraphViewModels(
            result.items,
            buildGitGraphColorMap(result),
            getGitGraphHeadRef(result)
          )
        : [],
    [result]
  )
  const graphWidth = useMemo(() => {
    let lanes = 1
    for (const viewModel of viewModels) {
      lanes = Math.max(lanes, viewModel.inputSwimlanes.length, viewModel.outputSwimlanes.length)
    }
    return Math.min(MAX_GRAPH_COLUMN_WIDTH, Math.max(44, GRAPH_LANE_WIDTH * (lanes + 1)))
  }, [viewModels])

  const indexById = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach((item, index) => {
      if (!map.has(item.id)) {
        map.set(item.id, index)
      }
    })
    return map
  }, [items])
  // Why: selection is by commit id, so it survives refreshes that shift row indexes.
  const selectedIndex = selectedId === null ? -1 : (indexById.get(selectedId) ?? -1)
  const selectedViewModel = selectedIndex === -1 ? null : (viewModels[selectedIndex] ?? null)
  const selectedItem = selectedIndex === -1 ? null : (items[selectedIndex] ?? null)

  const matches = useMemo(() => findGitGraphMatchIndexes(items, query), [items, query])
  const matchedIndexes = useMemo(() => new Set(matches), [matches])
  const activeMatchPosition = matches.indexOf(selectedIndex) + 1

  const selectIndex = useCallback(
    (index: number) => {
      const item = items[index]
      if (item) {
        setSelectedId(item.id)
        setDetailOpen(true)
      }
    },
    [items]
  )
  const revealIndex = useCallback(
    (index: number) => {
      selectIndex(index)
      listRef.current?.scrollToIndex(index, 'center')
    },
    [selectIndex]
  )
  const handleFind = useCallback(
    (direction: 1 | -1) => {
      const next = stepGitGraphMatch(matches, selectedIndex, direction)
      if (next !== undefined) {
        revealIndex(next)
      }
    },
    [matches, revealIndex, selectedIndex]
  )

  const headOid = result?.headOid ?? result?.currentRef?.revision
  const handleLocateHead = useCallback(() => {
    const index = headOid ? indexById.get(headOid) : undefined
    if (index === undefined) {
      toast.info(
        translate(
          'auto.components.gitGraph.toolbar.headNotLoaded',
          'HEAD is not in the commits shown for this scope.'
        )
      )
      return
    }
    revealIndex(index)
    listRef.current?.focus()
  }, [headOid, indexById, revealIndex])

  // Why: a detached HEAD has no branch ref; the toolbar and status bar need that to relabel "Current branch".
  const isDetachedHead = Boolean(result?.headOid) && !result?.currentRef

  const isMac = useMemo(() => navigator.userAgent.includes('Mac'), [])
  const resolveSplitTargetGroupId = useGitGraphSplitTarget(worktreeId, isMac)
  const { loadCommitFiles, openHistoryCommitDiff, openCommitFile, handleCommitAction } =
    useGitHistoryCommitActions({
      activeWorktreeId: worktreeId,
      worktreePath: context.worktreePath,
      activeRepoTarget: context.target,
      resolveSplitTargetGroupId,
      resolveContext
    })
  const commitFiles = useGitGraphCommitFiles(detailOpen ? selectedItem : null, loadCommitFiles)
  const openCommit = useCallback(
    (item: GitHistoryItem) => void openHistoryCommitDiff(item),
    [openHistoryCommitDiff]
  )

  const handleRootKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
    if (primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }

  const message = renderGitGraphHistoryMessage({ state, onRetry: refresh })
  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={handleRootKeyDown}>
      <GitGraphToolbar
        filter={filter}
        onFilterChange={handleFilterChange}
        showRemoteBranches={showRemoteBranches}
        onShowRemoteBranchesChange={handleShowRemoteBranchesChange}
        isDetachedHead={isDetachedHead}
        refs={knownRefs}
        query={query}
        onQueryChange={setQuery}
        onFind={handleFind}
        matchCount={matches.length}
        activeMatchPosition={activeMatchPosition}
        searchInputRef={searchInputRef}
        busy={state.refreshing || state.status === 'loading'}
        onRefresh={refresh}
        canLocateHead={Boolean(headOid)}
        onLocateHead={handleLocateHead}
      />
      {message ?? (
        <div className="flex min-h-0 flex-1 flex-col @4xl/git-graph:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <GitGraphCommitList
              ref={listRef}
              listId={listId}
              viewModels={viewModels}
              selectedIndex={selectedIndex}
              matchedIndexes={matchedIndexes}
              graphWidth={graphWidth}
              hasMore={Boolean(result?.hasMore && result.nextCursor)}
              loadingMore={state.loadingMore}
              loadMoreError={state.loadMoreError}
              ariaLabel={translate('auto.components.gitGraph.list.label', 'Commits')}
              filteredRefIds={filteredRefIds}
              onLoadMore={loadMore}
              onSelect={selectIndex}
              onOpenCommit={openCommit}
              onCommitAction={handleCommitAction}
              onToggleFilterRef={handleToggleFilterRef}
            />
          </div>
          {detailOpen && selectedItem && selectedViewModel && (
            <div className="flex h-[45%] min-h-40 shrink-0 flex-col border-t border-border @4xl/git-graph:h-auto @4xl/git-graph:w-[min(26rem,40%)] @4xl/git-graph:border-t-0 @4xl/git-graph:border-l">
              <GitGraphCommitDetail
                item={selectedViewModel.historyItem}
                filesState={commitFiles.state}
                isCommitLoaded={(id) => indexById.has(id)}
                onSelectCommit={(id) => {
                  const index = indexById.get(id)
                  if (index !== undefined) {
                    revealIndex(index)
                  }
                }}
                onRetryFiles={commitFiles.retry}
                onOpenFile={(entry, event) => openCommitFile(selectedItem, entry, event)}
                onOpenAll={() => openCommit(selectedItem)}
                onCopyHash={() => handleCommitAction('copy-hash', selectedItem)}
                onClose={() => {
                  setDetailOpen(false)
                  listRef.current?.focus()
                }}
              />
            </div>
          )}
        </div>
      )}
      <GitGraphStatusBar
        state={state}
        filter={filter}
        refsById={refsById}
        isDetachedHead={isDetachedHead}
      />
    </div>
  )
}

export function GitGraphPanel({ file }: { file: OpenFile }): React.JSX.Element {
  const { owner, resolveContext } = useGitGraphOwner(file)
  return (
    <div
      className="@container/git-graph flex h-full min-h-0 w-full min-w-0 flex-col bg-background text-foreground"
      data-testid="git-graph-panel"
    >
      {owner.status === 'ready' ? (
        // Why keyed: a new owner must not inherit the previous host's rows, selection or diff cache.
        <GitGraphReadyView
          key={owner.key}
          context={owner.context}
          ownerKey={owner.key}
          resolveContext={resolveContext}
        />
      ) : (
        <GitGraphOwnerMessage owner={owner} />
      )}
    </div>
  )
}
