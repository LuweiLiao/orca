import React, { useMemo, useState } from 'react'
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
import { translate } from '@/i18n/i18n'
import type { GitHistoryItemRef, GitHistoryRefCategory } from '../../../../shared/git-history-types'

// Why: tag-heavy repositories carry thousands of refs; render a bounded slice and ask to refine.
const MAX_SHOWN_REFS = 200

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

export function GitGraphRefPicker({
  refs,
  value,
  onChange
}: {
  refs: readonly GitHistoryItemRef[]
  value: string | undefined
  onChange: (refId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = refs.find((ref) => ref.id === value)
  const label = translate('auto.components.gitGraph.refPicker.label', 'Branch or tag')
  const { groups, hiddenCount } = useMemo(() => {
    if (!open) {
      return { groups: [], hiddenCount: 0 }
    }
    const needle = query.trim().toLowerCase()
    const matching = needle ? refs.filter((ref) => ref.name.toLowerCase().includes(needle)) : refs
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
  }, [open, query, refs])

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
          className="max-w-48 min-w-24 justify-between"
        >
          <span className="min-w-0 truncate">
            {selected?.name ??
              translate('auto.components.gitGraph.refPicker.placeholder', 'Choose a ref…')}
          </span>
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-1rem))]">
        <Command shouldFilter={false} density="menu" label={label}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={translate(
              'auto.components.gitGraph.refPicker.search',
              'Search branches and tags'
            )}
            aria-label={translate(
              'auto.components.gitGraph.refPicker.search',
              'Search branches and tags'
            )}
          />
          <CommandList>
            <CommandEmpty>
              {translate('auto.components.gitGraph.refPicker.empty', 'No matching refs')}
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.category} heading={categoryHeading(group.category)}>
                {group.refs.map((ref) => (
                  <CommandItem
                    key={ref.id}
                    value={ref.id}
                    selection="palette"
                    onSelect={() => {
                      setOpen(false)
                      if (ref.id !== value) {
                        onChange(ref.id)
                      }
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{ref.name}</span>
                    {ref.id === value ? <Check className="size-3.5 shrink-0" /> : null}
                  </CommandItem>
                ))}
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
