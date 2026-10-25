import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { GitHistoryItem } from '../../../../shared/git-history-types'
import type { GitHistoryItemViewModel } from '../../../../shared/git-history-graph'
import type { GitHistoryCommitAction } from '../right-sidebar/source-control/sync/git-history-commit-context-menu'
import { GIT_GRAPH_ROW_HEIGHT, GitGraphRow, getGitGraphRowDomId } from './git-graph-row'

const ROW_OVERSCAN = 12
// Why: prefetch before the user reaches the end so scrolling rarely waits on a page.
const LOAD_MORE_THRESHOLD_ROWS = 30

export type GitGraphCommitListHandle = {
  scrollToIndex: (index: number, align?: 'auto' | 'center') => void
  focus: () => void
}

type GitGraphCommitListProps = {
  listId: string
  viewModels: readonly GitHistoryItemViewModel[]
  selectedIndex: number
  matchedIndexes: ReadonlySet<number>
  graphWidth: number
  hasMore: boolean
  loadingMore: boolean
  loadMoreError?: string
  ariaLabel: string
  onLoadMore: () => void
  onSelect: (index: number) => void
  onOpenCommit: (item: GitHistoryItem) => void
  onCommitAction: (action: GitHistoryCommitAction, item: GitHistoryItem) => void
  ref?: React.Ref<GitGraphCommitListHandle>
}

function nextKeyboardIndex(
  key: string,
  current: number,
  count: number,
  pageRows: number
): number | null {
  if (count === 0) {
    return null
  }
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(count - 1, current + 1)
    case 'ArrowUp':
      return current < 0 ? 0 : Math.max(0, current - 1)
    case 'PageDown':
      return Math.min(count - 1, Math.max(0, current) + pageRows)
    case 'PageUp':
      return Math.max(0, current - pageRows)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

function ColumnHeader({ graphWidth }: { graphWidth: number }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="flex h-6 shrink-0 items-center gap-2 border-b border-border pr-3 pl-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      <span className="shrink-0 truncate" style={{ width: graphWidth }}>
        {translate('auto.components.gitGraph.list.graphColumn', 'Graph')}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {translate('auto.components.gitGraph.list.descriptionColumn', 'Description')}
      </span>
      <span className="hidden w-36 shrink-0 truncate @2xl/git-graph:block">
        {translate('auto.components.gitGraph.list.authorColumn', 'Author')}
      </span>
      <span className="hidden w-36 shrink-0 truncate @3xl/git-graph:block">
        {translate('auto.components.gitGraph.list.dateColumn', 'Date')}
      </span>
      <span className="hidden w-16 shrink-0 truncate @lg/git-graph:block">
        {translate('auto.components.gitGraph.list.commitColumn', 'Commit')}
      </span>
    </div>
  )
}

export function GitGraphCommitList({
  listId,
  viewModels,
  selectedIndex,
  matchedIndexes,
  graphWidth,
  hasMore,
  loadingMore,
  loadMoreError,
  ariaLabel,
  onLoadMore,
  onSelect,
  onOpenCommit,
  onCommitAction,
  ref
}: GitGraphCommitListProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [listFocused, setListFocused] = React.useState(false)
  const showFooter = hasMore || Boolean(loadMoreError)
  const count = viewModels.length + (showFooter ? 1 : 0)
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GIT_GRAPH_ROW_HEIGHT,
    overscan: ROW_OVERSCAN
  })

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index, align = 'auto') => virtualizer.scrollToIndex(index, { align }),
      focus: () => scrollRef.current?.focus()
    }),
    [virtualizer]
  )

  // Why: a refresh can prepend new commits; keep the commit at the top of the viewport in place.
  const anchorRef = useRef<{ id: string; index: number; offset: number } | null>(null)
  const recordAnchor = useCallback(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }
    const index = Math.floor(element.scrollTop / GIT_GRAPH_ROW_HEIGHT)
    const id = viewModels[index]?.historyItem.id
    anchorRef.current =
      id === undefined ? null : { id, index, offset: element.scrollTop % GIT_GRAPH_ROW_HEIGHT }
  }, [viewModels])
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const element = scrollRef.current
    // Why: a viewer parked at the very top wants to see new commits, not keep the old tip.
    if (!anchor || !element || (anchor.index === 0 && anchor.offset === 0)) {
      recordAnchor()
      return
    }
    const index = viewModels.findIndex((viewModel) => viewModel.historyItem.id === anchor.id)
    if (index !== -1 && index !== anchor.index) {
      element.scrollTop = index * GIT_GRAPH_ROW_HEIGHT + anchor.offset
    }
    recordAnchor()
  }, [recordAnchor, viewModels])

  const virtualItems = virtualizer.getVirtualItems()
  const lastVisibleIndex = virtualItems.at(-1)?.index ?? -1
  useEffect(() => {
    if (
      hasMore &&
      !loadingMore &&
      !loadMoreError &&
      lastVisibleIndex >= viewModels.length - LOAD_MORE_THRESHOLD_ROWS
    ) {
      onLoadMore()
    }
  }, [hasMore, lastVisibleIndex, loadMoreError, loadingMore, onLoadMore, viewModels.length])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.metaKey || event.ctrlKey) {
      return
    }
    const selected = viewModels[selectedIndex]?.historyItem
    if (event.key === 'Enter' && selected) {
      event.preventDefault()
      onOpenCommit(selected)
      return
    }
    const pageRows = Math.max(
      1,
      Math.floor((scrollRef.current?.clientHeight ?? 0) / GIT_GRAPH_ROW_HEIGHT) - 1
    )
    const next = nextKeyboardIndex(event.key, selectedIndex, viewModels.length, pageRows)
    if (next === null) {
      return
    }
    event.preventDefault()
    onSelect(next)
    virtualizer.scrollToIndex(next, { align: 'auto' })
  }

  const selectedId = viewModels[selectedIndex]?.historyItem.id
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ColumnHeader graphWidth={graphWidth} />
      <div
        ref={scrollRef}
        role="listbox"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-activedescendant={selectedId ? getGitGraphRowDomId(listId, selectedId) : undefined}
        className="scrollbar-sleek min-h-0 flex-1 overflow-auto outline-none"
        onScroll={recordAnchor}
        onKeyDown={handleKeyDown}
        onFocus={() => setListFocused(true)}
        onBlur={() => setListFocused(false)}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtualItem) => {
            const viewModel = viewModels[virtualItem.index]
            if (!viewModel) {
              return (
                <div
                  key="git-graph-footer"
                  className="absolute top-0 left-0 flex w-full items-center gap-2 px-3 text-xs text-muted-foreground"
                  style={{
                    height: GIT_GRAPH_ROW_HEIGHT,
                    transform: `translateY(${virtualItem.start}px)`
                  }}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      {translate(
                        'auto.components.gitGraph.list.loadingMore',
                        'Loading more commits…'
                      )}
                    </>
                  ) : loadMoreError ? (
                    <>
                      <span className="min-w-0 truncate text-destructive">{loadMoreError}</span>
                      <Button type="button" variant="ghost" size="xs" onClick={onLoadMore}>
                        {translate('auto.components.gitGraph.list.retry', 'Retry')}
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="ghost" size="xs" onClick={onLoadMore}>
                      {translate('auto.components.gitGraph.list.loadMore', 'Load more commits')}
                    </Button>
                  )}
                </div>
              )
            }
            return (
              <GitGraphRow
                key={viewModel.historyItem.id}
                listId={listId}
                index={virtualItem.index}
                setSize={viewModels.length}
                start={virtualItem.start}
                viewModel={viewModel}
                graphWidth={graphWidth}
                selected={virtualItem.index === selectedIndex}
                matched={matchedIndexes.has(virtualItem.index)}
                listFocused={listFocused}
                onSelect={onSelect}
                onOpenCommit={onOpenCommit}
                onCommitAction={onCommitAction}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
