import React from 'react'
import { ChevronDown, ChevronUp, LocateFixed, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { GitHistoryItemRef } from '../../../../shared/git-history-types'
import { GitGraphBranchFilterPicker } from './git-graph-ref-picker'
import type { GitGraphBranchFilter } from './git-graph-branch-filter'

function ToolbarIconButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Why: a span keeps the tooltip reachable while the button is disabled. */}
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function GitGraphToolbar({
  filter,
  onFilterChange,
  showRemoteBranches,
  onShowRemoteBranchesChange,
  isDetachedHead,
  refs,
  query,
  onQueryChange,
  onFind,
  matchCount,
  activeMatchPosition,
  searchInputRef,
  busy,
  onRefresh,
  canLocateHead,
  onLocateHead
}: {
  filter: GitGraphBranchFilter
  onFilterChange: (next: GitGraphBranchFilter) => void
  showRemoteBranches: boolean
  onShowRemoteBranchesChange: (next: boolean) => void
  isDetachedHead: boolean
  refs: readonly GitHistoryItemRef[]
  query: string
  onQueryChange: (query: string) => void
  onFind: (direction: 1 | -1) => void
  matchCount: number
  activeMatchPosition: number
  searchInputRef: React.Ref<HTMLInputElement>
  busy: boolean
  onRefresh: () => void
  canLocateHead: boolean
  onLocateHead: () => void
}): React.JSX.Element {
  const hasQuery = query.trim().length > 0
  const searchLabel = translate('auto.components.gitGraph.search.label', 'Search loaded commits')
  return (
    <div
      role="toolbar"
      aria-label={translate('auto.components.gitGraph.toolbar.label', 'Git graph')}
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1"
    >
      <GitGraphBranchFilterPicker
        refs={refs}
        filter={filter}
        onFilterChange={onFilterChange}
        showRemoteBranches={showRemoteBranches}
        isDetachedHead={isDetachedHead}
      />
      {/* Why outside the dropdown: VS Code Git Graph keeps this toggle beside the branch picker. */}
      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 px-1 text-xs text-muted-foreground select-none">
        <Checkbox
          checked={showRemoteBranches}
          onCheckedChange={(checked) => onShowRemoteBranchesChange(checked === true)}
          className="size-3.5"
        />
        {translate('auto.components.gitGraph.filter.showRemoteBranches', 'Show remote branches')}
      </label>
      <div className="order-last flex min-w-0 basis-full items-center gap-1 @2xl/git-graph:order-none @2xl/git-graph:ml-auto @2xl/git-graph:max-w-80 @2xl/git-graph:flex-1 @2xl/git-graph:basis-80">
        <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          type="search"
          density="compact"
          value={query}
          placeholder={searchLabel}
          aria-label={searchLabel}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              onFind(event.shiftKey ? -1 : 1)
            } else if (event.key === 'Escape' && hasQuery) {
              event.preventDefault()
              event.stopPropagation()
              onQueryChange('')
            }
          }}
        />
        {hasQuery && (
          <span
            aria-live="polite"
            className={cn(
              'shrink-0 px-1 text-2xs tabular-nums',
              matchCount === 0 ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {matchCount === 0
              ? translate('auto.components.gitGraph.search.noMatches', 'No matches')
              : translate('auto.components.gitGraph.search.position', '{{value0}} of {{value1}}', {
                  value0: activeMatchPosition > 0 ? activeMatchPosition : '–',
                  value1: matchCount
                })}
          </span>
        )}
        <ToolbarIconButton
          label={translate('auto.components.gitGraph.search.previous', 'Previous match')}
          disabled={matchCount === 0}
          onClick={() => onFind(-1)}
        >
          <ChevronUp />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={translate('auto.components.gitGraph.search.next', 'Next match')}
          disabled={matchCount === 0}
          onClick={() => onFind(1)}
        >
          <ChevronDown />
        </ToolbarIconButton>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ToolbarIconButton
          label={translate('auto.components.gitGraph.toolbar.locateHead', 'Go to HEAD commit')}
          disabled={!canLocateHead}
          onClick={onLocateHead}
        >
          <LocateFixed />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={translate('auto.components.gitGraph.toolbar.refresh', 'Refresh graph')}
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw className={cn(busy && 'animate-spin')} />
        </ToolbarIconButton>
      </div>
    </div>
  )
}
