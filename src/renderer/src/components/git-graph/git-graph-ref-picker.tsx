import React, { useCallback, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { GitHistoryItemRef, GitHistoryRefCategory } from '../../../../shared/git-history-types'
import {
  ALL_BRANCHES_FILTER,
  CURRENT_BRANCH_FILTER,
  toggleGitGraphFilterRef,
  type GitGraphBranchFilter
} from './git-graph-branch-filter'

// Why: tag-heavy repositories carry thousands of refs; render a bounded slice and ask to refine.
const MAX_SHOWN_REFS = 200
const MAX_TRIGGER_NAMES = 2

const CATEGORY_ORDER: readonly (GitHistoryRefCategory | 'other')[] = [
  'branches',
  'remote branches',
  'tags',
  'other'
]

function categoryHeading(category: GitHistoryRefCategory | 'other'): string {
  switch (category) {
    case 'branches':
      return translate('auto.components.gitGraph.refPicker.branches', 'Branches')
    case 'remote branches':
      return translate('auto.components.gitGraph.refPicker.remoteBranches', 'Remote branches')
    case 'tags':
      return translate('auto.components.gitGraph.refPicker.tags', 'Tags')
    case 'commits':
    case 'other':
      return translate('auto.components.gitGraph.refPicker.other', 'Other refs')
  }
}

/** Toolbar trigger text for the current filter; detached HEAD replaces the "Current branch" label. */
export function gitGraphBranchFilterLabel(
  filter: GitGraphBranchFilter,
  refsById: ReadonlyMap<string, GitHistoryItemRef>,
  isDetachedHead: boolean
): string {
  if (filter.mode === 'head') {
    return isDetachedHead
      ? translate('auto.components.gitGraph.filter.detachedHead', 'HEAD (detached)')
      : translate('auto.components.gitGraph.filter.currentBranch', 'Current branch')
  }
  if (filter.mode === 'all') {
    return translate('auto.components.gitGraph.filter.allBranches', 'All branches')
  }
  const names = filter.refIds.map((id) => refsById.get(id)?.name ?? id)
  if (names.length <= MAX_TRIGGER_NAMES) {
    return names.join(', ')
  }
  const [first] = names
  return translate('auto.components.gitGraph.filter.selectedAndMore', '{{value0}} +{{value1}}', {
    value0: first,
    value1: names.length - 1
  })
}

export function GitGraphBranchFilterPicker({
  refs,
  filter,
  onFilterChange,
  showRemoteBranches,
  onShowRemoteBranchesChange,
  isDetachedHead
}: {
  refs: readonly GitHistoryItemRef[]
  filter: GitGraphBranchFilter
  onFilterChange: (next: GitGraphBranchFilter) => void
  showRemoteBranches: boolean
  onShowRemoteBranchesChange: (next: boolean) => void
  isDetachedHead: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const label = translate('auto.components.gitGraph.filter.label', 'Branch filter')
  const refsById = useMemo(() => new Map(refs.map((ref) => [ref.id, ref])), [refs])
  const selectedIds = useMemo(
    () => (filter.mode === 'selected' ? new Set(filter.refIds) : new Set<string>()),
    [filter]
  )
  const visibleRefs = useMemo(
    () => (showRemoteBranches ? refs : refs.filter((ref) => ref.category !== 'remote branches')),
    [refs, showRemoteBranches]
  )
  const { groups, hiddenCount } = useMemo(() => {
    if (!open) {
      return { groups: [], hiddenCount: 0 }
    }
    const needle = query.trim().toLowerCase()
    const matching = needle
      ? visibleRefs.filter((ref) => ref.name.toLowerCase().includes(needle))
      : visibleRefs
    const shown = matching.slice(0, MAX_SHOWN_REFS)
    return {
      groups: CATEGORY_ORDER.map((category) => ({
        category,
        refs: shown.filter((ref) =>
          category === 'other'
            ? !ref.category || ref.category === 'commits'
            : ref.category === category
        )
      })).filter((group) => group.refs.length > 0),
      hiddenCount: matching.length - shown.length
    }
  }, [open, query, visibleRefs])

  const handleToggleRef = useCallback(
    (refId: string) => onFilterChange(toggleGitGraphFilterRef(filter, refId)),
    [filter, onFilterChange]
  )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setQuery('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          title={gitGraphBranchFilterLabel(filter, refsById, isDetachedHead)}
          className="max-w-56 min-w-28 justify-between"
        >
          <span className="min-w-0 truncate">
            {gitGraphBranchFilterLabel(filter, refsById, isDetachedHead)}
          </span>
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-1rem))]">
        <Command shouldFilter={false} density="menu" label={label}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={translate('auto.components.gitGraph.refPicker.search', 'Search branches…')}
            aria-label={translate('auto.components.gitGraph.refPicker.search', 'Search branches…')}
          />
          <div className="border-b border-border">
            <button
              type="button"
              onClick={() => {
                if (filter.mode !== 'all') {
                  onFilterChange(ALL_BRANCHES_FILTER)
                }
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
                filter.mode === 'all' && 'opacity-80'
              )}
            >
              <Check
                className={cn(
                  'size-3 text-muted-foreground',
                  filter.mode === 'all' ? 'opacity-70' : 'opacity-0'
                )}
              />
              <span>
                {translate('auto.components.gitGraph.filter.allBranches', 'All branches')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (filter.mode !== 'head') {
                  onFilterChange(CURRENT_BRANCH_FILTER)
                }
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
                filter.mode === 'head' && 'opacity-80'
              )}
            >
              <Check
                className={cn(
                  'size-3 text-muted-foreground',
                  filter.mode === 'head' ? 'opacity-70' : 'opacity-0'
                )}
              />
              <span>
                {isDetachedHead
                  ? translate('auto.components.gitGraph.filter.detachedHead', 'HEAD (detached)')
                  : translate('auto.components.gitGraph.filter.currentBranch', 'Current branch')}
              </span>
            </button>
            <label className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">
                {translate(
                  'auto.components.gitGraph.filter.showRemoteBranches',
                  'Show remote branches'
                )}
              </span>
              <Switch
                checked={showRemoteBranches}
                onCheckedChange={onShowRemoteBranchesChange}
                thumbClassName="size-3"
                className="h-4 w-7"
              />
            </label>
          </div>
          <CommandList>
            <CommandEmpty>
              {translate('auto.components.gitGraph.refPicker.empty', 'No matching refs')}
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.category} heading={categoryHeading(group.category)}>
                {group.refs.map((ref) => {
                  const isSelected = selectedIds.has(ref.id)
                  return (
                    <CommandItem
                      key={ref.id}
                      value={ref.id}
                      selection="palette"
                      onSelect={() => handleToggleRef(ref.id)}
                    >
                      <Check
                        className={cn(
                          'size-3 shrink-0 text-muted-foreground',
                          isSelected ? 'opacity-70' : 'opacity-0'
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{ref.name}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
          {hiddenCount > 0 && (
            <div className="border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
              {translate(
                'auto.components.gitGraph.refPicker.more',
                '{{value0}} more refs. Type to narrow the list.',
                { value0: hiddenCount }
              )}
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
