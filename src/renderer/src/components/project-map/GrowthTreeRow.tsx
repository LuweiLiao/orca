import { memo } from 'react'
import { ArrowDownLeft, ArrowUpRight, CircleDashed, Folder, GitBranch } from 'lucide-react'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { AgentStateDot } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { growthDateTime } from './growth-tree-labels'
import { GROWTH_LAYOUT, type GrowthLayoutPin, type GrowthLayoutRow } from './growth-tree-layout'
import type { GrowthTreeBar, GrowthTreeLane } from './growth-tree-types'
import { projectMapStateLabel } from './project-map-labels'

type CssVariables = React.CSSProperties & Record<`--${string}`, string | number>

/** Points `--gt-lane` at one of the cycling lane colours. */
export function growthLaneStyle(color: number): CssVariables {
  return { '--gt-lane': `var(--gt-lane-${color})` }
}

type RowProps = {
  row: GrowthLayoutRow
  lane: GrowthTreeLane
  /** Null for a workspace row with no chats. */
  bar: GrowthTreeBar | null
  color: number
  textX: number
  now: number
  selected: boolean
  laneSelected: boolean
  linked: boolean
  dimmed: boolean
  cursor: boolean
  pins: readonly GrowthLayoutPin[]
  projectNames: ReadonlyMap<string, string>
  liveTargets: (id: string) => boolean
  onSelect: (id: string) => void
  onJump: (id: string) => void
  onPin: (pin: GrowthLayoutPin) => void
}

/** The workspace name on its newest row, like a branch label at a branch tip. */
function LaneChip({
  lane,
  color,
  selected,
  onSelect,
  onJump
}: {
  lane: GrowthTreeLane
  color: number
  selected: boolean
  onSelect: (id: string) => void
  onJump: (id: string) => void
}): React.JSX.Element {
  const Icon = lane.kind === 'folder' ? Folder : GitBranch
  const kind =
    lane.kind === 'folder' ? translate('growthTree.folderWorkspace', 'Folder workspace') : null
  const title = [lane.name, kind, lane.hostLabel].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      data-growth-lane-label={lane.id}
      aria-pressed={selected}
      aria-label={title}
      title={title}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(lane.id)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onJump(lane.id)
      }}
      className="growth-tree-chip pointer-events-auto flex max-w-48 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-2xs leading-5"
      style={growthLaneStyle(color)}
    >
      <Icon className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{lane.name}</span>
      {lane.hostLabel ? <span className="shrink-0 opacity-70">{lane.hostLabel}</span> : null}
    </button>
  )
}

function PinChip({
  pin,
  projectNames,
  live,
  onPin
}: {
  pin: GrowthLayoutPin
  projectNames: ReadonlyMap<string, string>
  live: boolean
  onPin: (pin: GrowthLayoutPin) => void
}): React.JSX.Element {
  const other = pin.otherProjectId
    ? (projectNames.get(pin.otherProjectId) ?? pin.otherProjectId)
    : ''
  const label =
    pin.kind === 'cross-in'
      ? translate('growthTree.pin.from', 'From project {{project}}', {
          project: other
        })
      : pin.kind === 'cross-out'
        ? translate('growthTree.pin.to', 'To project {{project}}', {
            project: other
          })
        : translate('growthTree.pin.unresolved', 'Source not loaded')
  const Icon =
    pin.kind === 'cross-in' ? ArrowDownLeft : pin.kind === 'cross-out' ? ArrowUpRight : CircleDashed
  return (
    <button
      type="button"
      data-growth-pin={pin.id}
      data-kind={pin.kind}
      aria-label={label}
      title={label}
      disabled={pin.kind === 'unresolved' || !live}
      onClick={(event) => {
        event.stopPropagation()
        onPin(pin)
      }}
      className="growth-tree-pin pointer-events-auto flex max-w-40 shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 text-2xs leading-5 text-muted-foreground"
    >
      <Icon className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}
/** One line of the tree: the dot sits in the graph on the left, the chat's text on the right. */
export const GrowthTreeRow = memo(function GrowthTreeRow({
  row,
  lane,
  bar,
  color,
  textX,
  now,
  selected,
  laneSelected,
  linked,
  dimmed,
  cursor,
  pins,
  projectNames,
  liveTargets,
  onSelect,
  onJump,
  onPin
}: RowProps) {
  const noChats = translate('growthTree.noChats', 'No conversations here yet')
  const label = bar
    ? `${bar.title}, ${projectMapStateLabel(bar.state)}, ${growthDateTime(bar.start)}`
    : `${lane.name}, ${noChats}`
  const target = bar ? bar.id : lane.id
  return (
    <div
      data-growth-row={row.id}
      className="growth-tree-row absolute inset-x-0"
      style={{ top: row.y, height: GROWTH_LAYOUT.rowHeight }}
    >
      <button
        type="button"
        data-growth-bar={bar ? bar.id : undefined}
        data-growth-lane-row={bar ? undefined : lane.id}
        data-start={bar?.start}
        data-end={bar?.end}
        data-history={bar?.history || undefined}
        data-approx={bar?.startApprox || undefined}
        data-running={bar?.running || undefined}
        data-selected={selected || undefined}
        data-linked={linked || undefined}
        data-dimmed={dimmed || undefined}
        data-cursor={cursor || undefined}
        aria-pressed={bar ? selected : laneSelected}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(target)
        }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          onJump(target)
        }}
        className="growth-tree-row-hit absolute inset-0"
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-2 pr-3"
        style={{ left: textX }}
      >
        {bar ? <AgentTypeIcon agentType={bar.agentType} size={14} /> : null}
        {row.tip ? (
          <LaneChip
            lane={lane}
            color={color}
            selected={laneSelected}
            onSelect={onSelect}
            onJump={onJump}
          />
        ) : null}
        <span
          className={`growth-tree-title min-w-0 flex-1 truncate text-sm ${bar ? '' : 'text-muted-foreground'}`}
        >
          {bar ? bar.title : noChats}
        </span>
        {pins.map((pin) => (
          <PinChip
            key={pin.id}
            pin={pin}
            projectNames={projectNames}
            live={liveTargets(pin.targets[0] ?? '')}
            onPin={onPin}
          />
        ))}
        {bar && !bar.history ? <AgentStateDot state={bar.state} title={null} /> : null}
        {bar ? (
          <span
            className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
            title={growthDateTime(bar.start)}
          >
            {formatUiRelativeTime(bar.start - now)}
          </span>
        ) : null}
      </div>
    </div>
  )
})
