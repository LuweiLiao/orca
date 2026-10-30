import { ChevronDown, ChevronRight, Folder, GitBranch } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { ProjectMapView } from './use-project-map-viewport'
import { growthClock, growthDay, growthFoldedSpan } from './growth-tree-labels'
import type { GrowthTick } from './growth-tree-ticks'
import type { GrowthLayout } from './growth-tree-layout'
import type { GrowthTree } from './growth-tree-types'

export const GROWTH_LABEL_WIDTH = 168
export const GROWTH_RULER_HEIGHT = 28

type LabelProps = {
  tree: GrowthTree
  layout: GrowthLayout
  view: ProjectMapView
  height: number
  selectedId: string | null
  onSelectLane: (id: string) => void
  onJumpLane: (id: string) => void
  onToggleGroup: (projectId: string) => void
}

/** Lane and project labels. Fixed in x; their y follows the content's pan and zoom. */
export function GrowthTreeLabels({
  tree,
  layout,
  view,
  height,
  selectedId,
  onSelectLane,
  onJumpLane,
  onToggleGroup
}: LabelProps): React.JSX.Element {
  const place = (y: number, h: number): React.CSSProperties => ({
    top: view.y + y * view.zoom,
    height: h * view.zoom
  })
  const visible = (y: number, h: number): boolean =>
    view.y + (y + h) * view.zoom >= 0 && view.y + y * view.zoom <= height
  return (
    <div
      data-growth-labels=""
      className="relative shrink-0 overflow-hidden border-r border-border bg-background"
      style={{ width: GROWTH_LABEL_WIDTH }}
    >
      {layout.groups.map((group) => {
        const project = tree.projects.find((candidate) => candidate.id === group.projectId)!
        const header = 32
        return (
          <div key={group.projectId}>
            {visible(group.y, header) ? (
              <button
                type="button"
                data-growth-group={group.projectId}
                aria-expanded={!group.collapsed}
                onClick={() => onToggleGroup(group.projectId)}
                className="absolute inset-x-0 flex items-center gap-1 overflow-hidden px-2 text-left text-[13px] font-medium hover:bg-accent/50"
                style={place(group.y, header)}
              >
                {group.collapsed ? (
                  <ChevronRight className="size-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                  {group.collapsed
                    ? translate(
                        'growthTree.groupCollapsed',
                        '{{chats}} chats, {{working}} working',
                        {
                          chats: project.chatCount,
                          working: project.workingCount
                        }
                      )
                    : project.chatCount}
                </span>
              </button>
            ) : null}
            {group.emptyY !== null && visible(group.emptyY, 24) ? (
              <div
                className="absolute inset-x-0 flex items-center px-3 text-2xs text-muted-foreground"
                style={place(group.emptyY, 24)}
              >
                {translate('growthTree.emptyLanes', 'Empty workspaces: {{count}}', {
                  count: group.emptyLaneIds.length
                })}
              </div>
            ) : null}
          </div>
        )
      })}
      {[...layout.lanes.values()].map((box) => {
        const lane = tree.lanes.get(box.id)!
        if (!visible(box.y, box.height)) {
          return null
        }
        const Icon = lane.kind === 'folder' ? Folder : GitBranch
        return (
          <button
            key={box.id}
            type="button"
            data-growth-lane-label={box.id}
            aria-pressed={selectedId === box.id}
            onClick={() => onSelectLane(box.id)}
            onDoubleClick={() => onJumpLane(box.id)}
            className="absolute inset-x-0 flex flex-col justify-center overflow-hidden px-3 text-left hover:bg-accent/50 data-[selected]:bg-accent"
            data-selected={selectedId === box.id || undefined}
            style={place(box.y, box.height)}
          >
            <span className="flex items-center gap-1.5 text-[13px]">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{lane.name}</span>
            </span>
            <span className="truncate pl-5 text-2xs text-muted-foreground">
              {lane.kind === 'folder'
                ? translate('growthTree.folderWorkspace', 'Folder workspace')
                : null}
              {lane.hostLabel ? ` ${lane.hostLabel}` : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const MIN_LABEL_GAP_PX = 44

/** Drops a mark that would sit on top of the one before it once the tree is zoomed out. */
function spacedOnScreen(zoom: number): (tick: GrowthTick, index: number) => boolean {
  let lastX = Number.NEGATIVE_INFINITY
  return (tick, index) => {
    if (index === 0 || (tick.x - lastX) * zoom >= MIN_LABEL_GAP_PX) {
      lastX = tick.x
      return true
    }
    return false
  }
}

/** The time ruler. Fixed in y; its x follows the content's pan and zoom. */
export function GrowthTreeRuler({
  layout,
  view,
  onToggleFold
}: {
  layout: GrowthLayout
  view: ProjectMapView
  onToggleFold: (from: number) => void
}): React.JSX.Element {
  const { scale, ticks } = layout
  const sequence = scale.mode === 'sequence'
  const multiDay = ticks.length > 1 && growthDay(ticks[0]!.time) !== growthDay(ticks.at(-1)!.time)
  const shortSpan = ticks.length > 1 && ticks.at(-1)!.time - ticks[0]!.time < 10 * 60 * 1000
  return (
    <div
      data-growth-ruler=""
      className="relative min-w-0 flex-1 overflow-hidden border-b border-border bg-background"
      style={{ height: GROWTH_RULER_HEIGHT }}
    >
      {ticks.filter(spacedOnScreen(view.zoom)).map((tick) => (
        <span
          key={tick.index}
          className="absolute top-0 flex h-full items-center border-l border-border pl-1 text-2xs text-muted-foreground tabular-nums"
          style={{ left: view.x + tick.x * view.zoom }}
        >
          {sequence
            ? tick.index + 1
            : multiDay
              ? growthDay(tick.time)
              : growthClock(tick.time, shortSpan)}
        </span>
      ))}
      {scale.folds.map((fold) => (
        <button
          key={fold.from}
          type="button"
          data-growth-fold-toggle={fold.from}
          aria-pressed={fold.expanded}
          title={growthFoldedSpan(fold.from, fold.to)}
          aria-label={growthFoldedSpan(fold.from, fold.to)}
          onClick={() => onToggleFold(fold.from)}
          className="absolute top-0 flex h-full items-center justify-center text-2xs text-muted-foreground hover:bg-accent/50"
          style={{ left: view.x + fold.x * view.zoom, width: fold.width * view.zoom }}
        >
          {fold.expanded ? '↔' : '~'}
        </button>
      ))}
    </div>
  )
}
