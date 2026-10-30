import { memo } from 'react'
import { ArrowDownLeft, ArrowUpRight, CircleDashed } from 'lucide-react'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { AgentStateDot } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { growthBarMatches, type GrowthFocus, type GrowthTreeFilter } from './growth-tree-focus'
import { growthDateTime, growthFoldedSpan } from './growth-tree-labels'
import type { GrowthLayout, GrowthLayoutBar, GrowthLayoutPin } from './growth-tree-layout'
import type { buildGrowthSummary } from './growth-tree-summary'
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
  /** The summary tier's lane strips and bundled lines; null draws the chats. */
  summary: ReturnType<typeof buildGrowthSummary> | null
  /** The chat the arrow keys are on. */
  cursorId: string | null
  zoom: number
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
  cursor,
  onSelect,
  onJump
}: {
  bar: GrowthTreeBar
  box: GrowthLayoutBar
  selected: boolean
  linked: boolean
  dimmed: boolean
  cursor: boolean
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
      data-cursor={cursor || undefined}
      data-start={bar.start}
      data-end={bar.end}
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
  summary,
  cursorId,
  zoom,
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
      data-growth-tier={summary ? 'summary' : 'bars'}
      className="absolute top-0 left-0 origin-top-left"
      style={{ width: layout.width, height: layout.height }}
    >
      {layout.groups.map((group) => (
        <div
          key={group.projectId}
          data-growth-group-band={group.projectId}
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
        data-growth-now=""
        className="growth-tree-now absolute top-0"
        style={{ left: nowX, height: layout.height }}
      />
      {layout.scale.folds
        .filter((fold) => !fold.expanded)
        .map((fold) => (
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
        <defs>
          <marker
            id="growth-reference-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 z" className="growth-tree-arrow" />
          </marker>
        </defs>
        {[...layout.lanes.values()].map((lane) =>
          lane.startX === null ? null : (
            <circle
              key={`start:${lane.id}`}
              cx={lane.startX}
              cy={lane.y + lane.height / 2}
              r={3}
              data-growth-lane-start={lane.id}
              data-approx={lane.startApprox || undefined}
              className="growth-tree-lane-start"
            />
          )
        )}
        {summary
          ? null
          : layout.wires.map((wire) => {
              const hidden = hiddenKinds.has(wire.kind)
              const inFocus = focus?.edges.has(wire.id) === true
              return hidden ? null : (
                <path
                  key={wire.id}
                  d={wire.path}
                  data-growth-wire={wire.id}
                  data-kind={wire.kind}
                  data-live={wire.live || undefined}
                  markerEnd={wire.kind === 'reference' ? 'url(#growth-reference-arrow)' : undefined}
                  data-highlighted={inFocus || undefined}
                  data-dimmed={(focus !== null && !inFocus) || undefined}
                  className="project-map-wire"
                />
              )
            })}
        {(summary ? [] : layout.joins).map((join) => (
          <circle
            key={join.id}
            cx={join.x}
            cy={join.y}
            r={4}
            data-growth-join={join.id}
            className="growth-tree-join"
          />
        ))}
        {summary?.bundles.map((bundle) => (
          <path
            key={bundle.id}
            d={bundle.path}
            data-growth-bundle={bundle.id}
            data-count={bundle.count}
            strokeWidth={(2 + Math.log2(bundle.count) * 2) / zoom}
            className="growth-tree-bundle"
          />
        ))}
      </svg>
      {summary?.lanes.map((strip) => {
        const lane = layout.lanes.get(strip.laneId)!
        return strip.cells.map((cell) => (
          <div
            key={`${strip.laneId}:${cell.x}`}
            data-growth-density={strip.laneId}
            data-working={cell.working > 0 || undefined}
            className="growth-tree-density absolute"
            style={{
              left: cell.x,
              top: lane.y + lane.height / 2 - 6,
              width: 22,
              height: 12,
              opacity: Math.min(1, 0.3 + cell.count * 0.2)
            }}
          />
        ))
      })}
      {summary?.bundles.map((bundle) => (
        <span
          key={`count:${bundle.id}`}
          data-growth-bundle-count={bundle.id}
          className="growth-tree-bundle-count absolute rounded-full border border-border bg-card tabular-nums"
          style={{
            left: bundle.labelX,
            top: bundle.labelY,
            fontSize: 12 / zoom,
            padding: `0 ${4 / zoom}px`,
            transform: 'translate(-50%, -50%)'
          }}
        >
          {bundle.count}
        </span>
      ))}
      {overlay}
      {(summary ? [] : [...layout.bars.values()]).map((box) => {
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
            cursor={cursorId === box.id}
            onSelect={onSelect}
            onJump={onJump}
          />
        )
      })}
      {(summary ? [] : layout.pins).map((pin) => (
        <PinButton key={pin.id} pin={pin} tree={tree} projectNames={projectNames} onPin={onPin} />
      ))}
    </div>
  )
}
