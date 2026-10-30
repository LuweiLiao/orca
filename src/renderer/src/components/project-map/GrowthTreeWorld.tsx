import { memo } from 'react'
import { ArrowDownLeft, ArrowUpRight, CircleDashed } from 'lucide-react'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { AgentStateDot } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { growthBarMatches, type GrowthFocus, type GrowthTreeFilter } from './growth-tree-focus'
import { growthDateTime, growthFoldedSpan } from './growth-tree-labels'
import type { GrowthLayout, GrowthLayoutBar, GrowthLayoutPin } from './growth-tree-layout'
import type { GrowthTree, GrowthTreeBar } from './growth-tree-types'
import { projectMapStateLabel } from './project-map-labels'
import './growth-tree.css'

const NARROW_BAR_PX = 64

type Props = {
  tree: GrowthTree
  layout: GrowthLayout
  selectedId: string | null
  focus: GrowthFocus | null
  filter: GrowthTreeFilter
  projectNames: ReadonlyMap<string, string>
  onSelect: (id: string) => void
  onJump: (id: string) => void
  onPin: (pin: GrowthLayoutPin) => void
  /** Drawn over the wires: a signal layer rides `layout.paths`. */
  overlay?: React.ReactNode
}

const BarButton = memo(function BarButton({
  bar,
  box,
  selected,
  linked,
  dimmed,
  onSelect,
  onJump
}: {
  bar: GrowthTreeBar
  box: GrowthLayoutBar
  selected: boolean
  linked: boolean
  dimmed: boolean
  onSelect: (id: string) => void
  onJump: (id: string) => void
}) {
  const state = projectMapStateLabel(bar.state)
  const label = `${bar.title}, ${state}, ${growthDateTime(bar.start)}`
  return (
    <button
      type="button"
      data-growth-bar={bar.id}
      data-selected={selected || undefined}
      data-linked={linked || undefined}
      data-dimmed={dimmed || undefined}
      data-history={bar.history || undefined}
      data-approx={bar.startApprox || undefined}
      data-running={bar.running || undefined}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(bar.id)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onJump(bar.id)
      }}
      className="growth-tree-bar absolute flex items-center gap-1.5 overflow-hidden rounded-md border border-border px-1.5 text-left text-xs"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      <AgentTypeIcon agentType={bar.agentType} size={12} />
      {box.width >= NARROW_BAR_PX ? (
        <span className="min-w-0 flex-1 truncate">{bar.title}</span>
      ) : null}
      {bar.history ? null : <AgentStateDot state={bar.state} title={null} />}
    </button>
  )
})

function PinButton({
  pin,
  tree,
  projectNames,
  onPin
}: {
  pin: GrowthLayoutPin
  tree: GrowthTree
  projectNames: ReadonlyMap<string, string>
  onPin: (pin: GrowthLayoutPin) => void
}) {
  const other = pin.otherProjectId
    ? (projectNames.get(pin.otherProjectId) ?? pin.otherProjectId)
    : ''
  const label =
    pin.kind === 'cross-in'
      ? translate('growthTree.pin.from', 'From project {{project}}', { project: other })
      : pin.kind === 'cross-out'
        ? translate('growthTree.pin.to', 'To project {{project}}', { project: other })
        : translate('growthTree.pin.unresolved', 'Source not loaded')
  const Icon =
    pin.kind === 'cross-in' ? ArrowDownLeft : pin.kind === 'cross-out' ? ArrowUpRight : CircleDashed
  const live = tree.bars.has(pin.targets[0] ?? '')
  return (
    <button
      type="button"
      data-growth-pin={pin.id}
      data-kind={pin.kind}
      aria-label={label}
      title={label}
      disabled={pin.kind === 'unresolved' || !live}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onPin(pin)
      }}
      className="growth-tree-pin absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
      style={{ left: pin.x, top: pin.y }}
    >
      <Icon className="size-2.5" />
    </button>
  )
}

export function GrowthTreeWorld({
  tree,
  layout,
  selectedId,
  focus,
  filter,
  projectNames,
  onSelect,
  onJump,
  onPin,
  overlay
}: Props): React.JSX.Element {
  const hiddenKinds = filter.hiddenKinds
  const nowX = layout.scale.xOf(tree.now)
  return (
    <div
      data-growth-world=""
      data-focusing={focus !== null || undefined}
      className="absolute top-0 left-0 origin-top-left"
      style={{ width: layout.width, height: layout.height }}
    >
      {layout.groups.map((group) => (
        <div
          key={group.projectId}
          className="growth-tree-group absolute left-0"
          style={{ top: group.y, height: group.height, width: layout.width }}
        />
      ))}
      {[...layout.lanes.values()].map((lane) => (
        <div
          key={lane.id}
          data-growth-lane={lane.id}
          data-selected={selectedId === lane.id || undefined}
          className="growth-tree-lane absolute left-0"
          style={{ top: lane.y, height: lane.height, width: lane.width }}
        />
      ))}
      <div
        className="growth-tree-now absolute top-0"
        style={{ left: nowX, height: layout.height }}
      />
      {layout.scale.folds.map((fold) => (
        <div
          key={fold.from}
          data-growth-fold=""
          title={growthFoldedSpan(fold.from, fold.to)}
          className="growth-tree-fold absolute top-0"
          style={{ left: fold.x, width: fold.width, height: layout.height }}
        />
      ))}
      <svg
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={layout.width}
        height={layout.height}
        aria-hidden
      >
        {layout.wires.map((wire) => {
          const hidden = hiddenKinds.has(wire.kind)
          const inFocus = focus?.edges.has(wire.id) === true
          return hidden ? null : (
            <path
              key={wire.id}
              d={wire.path}
              data-growth-wire={wire.id}
              data-kind={wire.kind}
              data-highlighted={inFocus || undefined}
              data-dimmed={(focus !== null && !inFocus) || undefined}
              className="project-map-wire"
            />
          )
        })}
        {layout.joins.map((join) => (
          <circle
            key={join.id}
            cx={join.x}
            cy={join.y}
            r={4}
            data-growth-join={join.id}
            className="growth-tree-join"
          />
        ))}
      </svg>
      {overlay}
      {[...layout.bars.values()].map((box) => {
        const bar = tree.bars.get(box.id)!
        return (
          <BarButton
            key={box.id}
            bar={bar}
            box={box}
            selected={selectedId === box.id}
            linked={focus?.nodes.has(box.id) === true}
            dimmed={
              (focus !== null && !focus.nodes.has(box.id)) ||
              !growthBarMatches(bar, filter, tree.now)
            }
            onSelect={onSelect}
            onJump={onJump}
          />
        )
      })}
      {layout.pins.map((pin) => (
        <PinButton key={pin.id} pin={pin} tree={tree} projectNames={projectNames} onPin={onPin} />
      ))}
    </div>
  )
}
