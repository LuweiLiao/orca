import React from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { GitHistoryItem, GitHistoryItemRef } from '../../../../shared/git-history-types'
import type { GitHistoryItemViewModel } from '../../../../shared/git-history-graph'
import { dedupeRemoteTrackingRefs } from '../../../../shared/git-history-ref-display'
import {
  GitHistoryGraphSvg,
  graphColor
} from '../right-sidebar/source-control/sync/git-history-graph-svg'
import {
  GitHistoryCommitContextMenu,
  type GitHistoryCommitAction
} from '../right-sidebar/source-control/sync/git-history-commit-context-menu'

// Why: rows must match the graph SVG's 24px swimlane height so lanes join between rows.
export const GIT_GRAPH_ROW_HEIGHT = 24
const MAX_VISIBLE_REFS = 3

// Why: commit dates follow the OS region, matching the sidebar history timestamps.
const rowDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export function formatGitGraphRowDate(timestamp: number | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return ''
  }
  return rowDateFormatter.format(new Date(timestamp))
}

export function getGitGraphRowDomId(listId: string, commitId: string): string {
  return `${listId}-commit-${commitId}`
}

export function GitGraphRefBadge({
  itemRef,
  isFiltered,
  onToggleFilter
}: {
  itemRef: GitHistoryItemRef
  /** Whether this ref is in the active branch filter selection; omitted hides the menu. */
  isFiltered?: boolean
  onToggleFilter?: (refId: string) => void
}): React.JSX.Element {
  const badge = (
    <span
      className="max-w-[10rem] shrink-0 truncate rounded-full border bg-background px-1.5 py-0.5 text-3xs leading-none"
      style={{
        borderColor: itemRef.color ? graphColor(itemRef.color) : 'var(--border)',
        color: itemRef.color ? graphColor(itemRef.color) : 'var(--muted-foreground)'
      }}
    >
      {itemRef.name}
    </span>
  )
  if (!onToggleFilter) {
    return badge
  }
  return (
    <ContextMenu>
      {/* Why: stop the native event so the row's own context menu does not also open. */}
      <ContextMenuTrigger asChild onContextMenu={(event) => event.stopPropagation()}>
        {badge}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onToggleFilter(itemRef.id)}>
          {isFiltered
            ? translate(
                'auto.components.gitGraph.branchFilter.removeFromFilter',
                'Remove from branch filter'
              )
            : translate(
                'auto.components.gitGraph.branchFilter.addToFilter',
                'Add to branch filter'
              )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

type GitGraphRowProps = {
  listId: string
  index: number
  setSize: number
  start: number
  viewModel: GitHistoryItemViewModel
  graphWidth: number
  selected: boolean
  matched: boolean
  listFocused: boolean
  onSelect: (index: number) => void
  onOpenCommit: (item: GitHistoryItem) => void
  onCommitAction: (action: GitHistoryCommitAction, item: GitHistoryItem) => void
  /** Selected ref ids in the toolbar's branch filter; undefined when the filter is not 'selected'. */
  filteredRefIds?: ReadonlySet<string>
  onToggleFilterRef?: (refId: string) => void
}

export const GitGraphRow = React.memo(function GitGraphRow({
  listId,
  index,
  setSize,
  start,
  viewModel,
  graphWidth,
  selected,
  matched,
  listFocused,
  onSelect,
  onOpenCommit,
  onCommitAction,
  filteredRefIds,
  onToggleFilterRef
}: GitGraphRowProps): React.JSX.Element {
  const item = viewModel.historyItem
  const refs = dedupeRemoteTrackingRefs(item.references ?? [])
  const visibleRefs = refs.slice(0, MAX_VISIBLE_REFS)
  const hiddenRefs = refs.slice(MAX_VISIBLE_REFS)
  const shortSha = item.displayId ?? item.id.slice(0, 8)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          id={getGitGraphRowDomId(listId, item.id)}
          role="option"
          aria-selected={selected}
          aria-posinset={index + 1}
          aria-setsize={setSize}
          data-current={selected ? 'true' : undefined}
          data-match={matched ? 'true' : undefined}
          data-testid="git-graph-row"
          className={cn(
            'absolute top-0 left-0 flex w-full cursor-pointer items-center gap-2 pr-3 pl-1 text-xs',
            selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
            !selected && matched && 'bg-accent/30',
            selected && listFocused && 'ring-1 ring-ring ring-inset'
          )}
          style={{ height: GIT_GRAPH_ROW_HEIGHT, transform: `translateY(${start}px)` }}
          onMouseDown={(event) => {
            // Why: keep keyboard focus on the listbox so arrows keep working after a click.
            if (event.button === 0) {
              event.preventDefault()
              event.currentTarget.closest<HTMLElement>('[role="listbox"]')?.focus()
            }
          }}
          onClick={() => onSelect(index)}
          onContextMenu={() => onSelect(index)}
          onDoubleClick={() => onOpenCommit(item)}
        >
          <div className="h-full shrink-0 overflow-hidden" style={{ width: graphWidth }}>
            <GitHistoryGraphSvg viewModel={viewModel} />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {visibleRefs.map((ref) => (
              <GitGraphRefBadge
                key={ref.id}
                itemRef={ref}
                isFiltered={filteredRefIds?.has(ref.id)}
                onToggleFilter={onToggleFilterRef}
              />
            ))}
            {hiddenRefs.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 text-3xs leading-none text-muted-foreground">
                    +{hiddenRefs.length}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4} className="max-w-72">
                  {hiddenRefs.map((ref) => ref.name).join(', ')}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="min-w-0 flex-1 truncate">{item.subject}</span>
          </div>
          <span className="hidden w-36 shrink-0 truncate text-muted-foreground @2xl/git-graph:block">
            {item.author}
          </span>
          <span className="hidden w-36 shrink-0 truncate text-muted-foreground @3xl/git-graph:block">
            {formatGitGraphRowDate(item.timestamp)}
          </span>
          <span className="hidden w-16 shrink-0 truncate font-mono text-muted-foreground @lg/git-graph:block">
            {shortSha}
          </span>
        </div>
      </ContextMenuTrigger>
      <GitHistoryCommitContextMenu item={item} onAction={onCommitAction} />
    </ContextMenu>
  )
})
