import { ChevronDown, ChevronRight } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { growthBarMatches, type GrowthFocus, type GrowthTreeFilter } from './growth-tree-focus'
import { GROWTH_LAYOUT, type GrowthLayout, type GrowthLayoutPin } from './growth-tree-layout'
import { growthLanePath } from './growth-tree-wires'
import type { GrowthTree } from './growth-tree-types'
import { GrowthTreeRow, growthLaneStyle } from './GrowthTreeRow'
import './growth-tree.css'

type Props = {
  tree: GrowthTree
  layout: GrowthLayout
  selectedId: string | null
  focus: GrowthFocus | null
  filter: GrowthTreeFilter
  projectNames: ReadonlyMap<string, string>
  /** The chat the arrow keys are on. */
  cursorId: string | null
  onSelect: (id: string) => void
  onJump: (id: string) => void
  onPin: (pin: GrowthLayoutPin) => void
  onToggleGroup: (projectId: string) => void
  /** Drawn over the graph: a signal layer rides `layout.paths`. */
  overlay?: React.ReactNode
}

function GroupHeader({
  tree,
  group,
  onToggle
}: {
  tree: GrowthTree
  group: GrowthLayout['groups'][number]
  onToggle: (projectId: string) => void
}): React.JSX.Element {
  const project = tree.projects.find((candidate) => candidate.id === group.projectId)!
  const Chevron = group.collapsed ? ChevronRight : ChevronDown
  return (
    <button
      type="button"
      data-growth-group={group.projectId}
      aria-expanded={!group.collapsed}
      onClick={(event) => {
        event.stopPropagation()
        onToggle(group.projectId)
      }}
      className="growth-tree-group absolute inset-x-0 flex items-center gap-1.5 px-2 text-left text-sm font-medium"
      style={{ top: group.y, height: GROWTH_LAYOUT.groupHeader }}
    >
      <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{project.name}</span>
      <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
        {translate('growthTree.groupCollapsed', '{{chats}} chats, {{working}} working', {
          chats: project.chatCount,
          working: project.workingCount
        })}
      </span>
      {group.emptyLaneIds.length > 0 ? (
        <span
          data-growth-empty-lanes={group.projectId}
          className="shrink-0 text-xs font-normal text-muted-foreground"
        >
          {translate('growthTree.emptyLanes', 'Empty workspaces: {{count}}', {
            count: group.emptyLaneIds.length
          })}
        </span>
      ) : null}
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
  cursorId,
  onSelect,
  onJump,
  onPin,
  onToggleGroup,
  overlay
}: Props): React.JSX.Element {
  const hiddenKinds = filter.hiddenKinds
  const pinsByRow = Map.groupBy(layout.pins, (pin) => pin.rowId)
  const outOfFocus = (id: string): boolean => focus !== null && !focus.nodes.has(id)
  const liveTargets = (id: string): boolean => tree.bars.has(id)
  return (
    <div
      data-growth-world=""
      data-focusing={focus !== null || undefined}
      className="relative"
      style={{ height: layout.height, minWidth: layout.width }}
    >
      {layout.groups.map((group) => (
        <GroupHeader key={group.projectId} tree={tree} group={group} onToggle={onToggleGroup} />
      ))}
      {[...layout.rows.values()].map((row) => {
        const bar = row.kind === 'chat' ? (tree.bars.get(row.id) ?? null) : null
        const lane = tree.lanes.get(row.laneId)!
        return (
          <GrowthTreeRow
            key={row.id}
            row={row}
            lane={lane}
            bar={bar}
            color={layout.lanes.get(row.laneId)!.color}
            textX={layout.textX}
            now={tree.now}
            selected={selectedId === row.id}
            laneSelected={selectedId === row.laneId}
            linked={focus?.nodes.has(row.id) === true}
            dimmed={
              outOfFocus(row.id) || (bar !== null && !growthBarMatches(bar, filter, tree.now))
            }
            cursor={cursorId === row.id}
            pins={pinsByRow.get(row.id) ?? []}
            projectNames={projectNames}
            liveTargets={liveTargets}
            onSelect={onSelect}
            onJump={onJump}
            onPin={onPin}
          />
        )
      })}
      <svg
        className="growth-tree-graph pointer-events-none absolute top-0 left-0 overflow-visible"
        width={layout.textX}
        height={layout.height}
        aria-hidden
      >
        <defs>
          <marker
            id="growth-reference-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 z" className="growth-tree-arrow" />
          </marker>
        </defs>
        {[...layout.lanes.values()].map((lane) =>
          lane.top === null || lane.bottom === null || lane.top === lane.bottom ? null : (
            <path
              key={lane.id}
              d={growthLanePath(lane.x, lane.top, lane.bottom)}
              data-growth-lane={lane.id}
              data-selected={selectedId === lane.id || undefined}
              className="growth-tree-lane"
              style={growthLaneStyle(lane.color)}
            />
          )
        )}
        {layout.wires.map((wire) => {
          if (hiddenKinds.has(wire.kind)) {
            return null
          }
          const inFocus = focus?.edges.has(wire.id) === true
          return (
            <path
              key={wire.id}
              d={wire.path}
              data-growth-wire={wire.id}
              data-kind={wire.kind}
              data-live={wire.live || undefined}
              data-highlighted={inFocus || undefined}
              data-dimmed={(focus !== null && !inFocus) || undefined}
              markerEnd={wire.kind === 'reference' ? 'url(#growth-reference-arrow)' : undefined}
              className="project-map-wire growth-tree-wire"
              style={wire.color === undefined ? undefined : growthLaneStyle(wire.color)}
            />
          )
        })}
        {[...layout.rows.values()].map((row) => {
          const bar = row.kind === 'chat' ? tree.bars.get(row.id) : undefined
          return (
            <circle
              key={row.id}
              cx={row.cx}
              cy={row.cy}
              r={selectedId === row.id ? GROWTH_LAYOUT.dotRadius + 1.5 : GROWTH_LAYOUT.dotRadius}
              data-growth-dot={row.id}
              data-kind={row.kind}
              data-history={bar?.history || undefined}
              data-running={bar?.running || undefined}
              data-selected={selectedId === row.id || undefined}
              data-dimmed={outOfFocus(row.id) || undefined}
              className="growth-tree-dot"
              style={growthLaneStyle(layout.lanes.get(row.laneId)!.color)}
            />
          )
        })}
      </svg>
      {overlay}
    </div>
  )
}
