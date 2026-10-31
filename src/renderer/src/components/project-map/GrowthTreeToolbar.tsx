import { Filter, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { DashboardBucket } from '../../../../shared/dashboard-snapshot'
import {
  GROWTH_EMPTY_FILTER,
  growthFilterActiveCount,
  type GrowthTimeWindow,
  type GrowthTreeFilter
} from './growth-tree-focus'
import { growthBucketLabel, growthKindLabel, growthWindowLabel } from './growth-tree-labels'
import { GROWTH_TREE_LINE_KINDS, type GrowthTreeLineKind } from './growth-tree-types'

const BUCKETS: readonly DashboardBucket[] = ['working', 'attention', 'done', 'idle']
const WINDOWS: readonly GrowthTimeWindow[] = ['all', 'today', '7d', '30d']

type Props = {
  filter: GrowthTreeFilter
  onFilter: (filter: GrowthTreeFilter) => void
  replay: boolean
  onReplay: () => void
}

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (!next.delete(value)) {
    next.add(value)
  }
  return next
}

function Check({
  id,
  checked,
  label,
  onChange
}: {
  id: string
  checked: boolean
  label: string
  onChange: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

export function GrowthTreeToolbar({
  filter,
  onFilter,
  replay,
  onReplay
}: Props): React.JSX.Element {
  const active = growthFilterActiveCount(filter)
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={translate('growthTree.filter.label', 'Filter')}
          >
            <Filter className="size-3.5" />
            {translate('growthTree.filter.label', 'Filter')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-2xs text-muted-foreground">
                {translate('growthTree.filter.status', 'Status')}
              </legend>
              {BUCKETS.map((bucket) => (
                <Check
                  key={bucket}
                  id={`growth-bucket-${bucket}`}
                  label={growthBucketLabel(bucket)}
                  checked={filter.buckets.has(bucket)}
                  onChange={() =>
                    onFilter({
                      ...filter,
                      buckets: toggled(filter.buckets, bucket)
                    })
                  }
                />
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-2xs text-muted-foreground">
                {translate('growthTree.filter.kinds', 'Lines drawn')}
              </legend>
              {GROWTH_TREE_LINE_KINDS.map((kind: GrowthTreeLineKind) => (
                <Check
                  key={kind}
                  id={`growth-kind-${kind}`}
                  label={growthKindLabel(kind)}
                  checked={!filter.hiddenKinds.has(kind)}
                  onChange={() =>
                    onFilter({
                      ...filter,
                      hiddenKinds: toggled(filter.hiddenKinds, kind)
                    })
                  }
                />
              ))}
            </fieldset>
            <Select
              value={filter.window}
              onValueChange={(value) =>
                onFilter({
                  ...filter,
                  window: WINDOWS.find((window) => window === value) ?? 'all'
                })
              }
            >
              <SelectTrigger
                size="sm"
                aria-label={translate('growthTree.filter.window', 'Time window')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((window) => (
                  <SelectItem key={window} value={window}>
                    {growthWindowLabel(window)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>
      {active > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-growth-filter-clear=""
          onClick={() => onFilter(GROWTH_EMPTY_FILTER)}
        >
          {translate('growthTree.filter.active', 'Filtered: {{count}}', {
            count: active
          })}
        </Button>
      ) : null}
      <Button
        type="button"
        variant={replay ? 'secondary' : 'outline'}
        size="sm"
        aria-pressed={replay}
        data-growth-replay-toggle=""
        onClick={onReplay}
      >
        <History className="size-3.5" />
        {translate('growthTree.replay.toggle', 'Replay')}
      </Button>
    </div>
  )
}
