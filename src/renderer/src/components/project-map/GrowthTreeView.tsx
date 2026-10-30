import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Network } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { GrowthTreeDock } from './GrowthTreeDock'
import {
  GROWTH_LABEL_WIDTH,
  GROWTH_RULER_HEIGHT,
  GrowthTreeLabels,
  GrowthTreeRuler
} from './GrowthTreeGutters'
import { GrowthTreeReplayBar } from './GrowthTreeReplayBar'
import { GrowthTreeToolbar } from './GrowthTreeToolbar'
import { GrowthTreeWorld } from './GrowthTreeWorld'
import { GROWTH_EMPTY_FILTER, growthFocus, growthWindowStart } from './growth-tree-focus'
import { buildGrowthSummary, GROWTH_SUMMARY_ZOOM } from './growth-tree-summary'
import { useGrowthTreeKeys } from './use-growth-tree-keys'
import {
  layoutGrowthTree,
  type GrowthLayoutPin,
  type GrowthTreePathIndex
} from './growth-tree-layout'
import type { GrowthTimeMode } from './growth-tree-scale'
import type { GrowthTree, GrowthTreeBar, GrowthTreeLane } from './growth-tree-types'
import { growthRevealShift } from './growth-tree-reveal'
import { growthTreeAt } from './growth-tree-replay'
import type { FlowSignalBus } from './project-flow-signal'
import { useGrowthTreeReplay } from './use-growth-tree-replay'
import { useProjectMapViewport } from './use-project-map-viewport'

const RECENT_FIT_MS = 7 * 24 * 60 * 60 * 1000
const READABLE_ZOOM = 0.8
const NOW_ROOM_PX = 120
const BAR_HEIGHT_FOR_CENTER = 22

export type GrowthTreeJumpTarget = {
  id: string
  projectId: string
  workspaceId: string
  /** Set when the person hid this chat in the blueprint. */
  hideKey: string | null
}

type Props = {
  tree: GrowthTree
  active: boolean
  /** Projects drawn; null draws all. */
  projectIds: ReadonlySet<string> | null
  projectNames: ReadonlyMap<string, string>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onJump: (target: GrowthTreeJumpTarget) => void
  onOpenBar: (bar: GrowthTreeBar) => void
  onOpenLane: (lane: GrowthTreeLane) => void
  /** A pin leads into a project the page is not showing. */
  onRevealProject: (projectId: string) => void
  /** The channel replayed events fly on; the overlay drawn over the wires listens to it. */
  bus: FlowSignalBus
  /** Drawn over the wires, given each node's box and each wire's path in world coordinates. */
  renderOverlay?: (paths: GrowthTreePathIndex) => React.ReactNode
}

export function GrowthTreeView({
  tree,
  active,
  projectIds,
  projectNames,
  selectedId,
  onSelect,
  onJump,
  onOpenBar,
  onOpenLane,
  onRevealProject,
  bus,
  renderOverlay
}: Props): React.JSX.Element {
  const [mode, setMode] = useState<GrowthTimeMode>('compressed')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [filter, setFilter] = useState(GROWTH_EMPTY_FILTER)
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<number>>(() => new Set())
  const [cursor, setCursor] = useState<string | null>(null)
  const [replayOpen, setReplayOpen] = useState(false)
  const replay = useGrowthTreeReplay({ tree, enabled: replayOpen, bus })
  const shown = useMemo(
    () => (replay.at === null ? tree : growthTreeAt(tree, replay.at)),
    [replay.at, tree]
  )
  const layout = useMemo(
    () => layoutGrowthTree({ tree, mode, collapsed, projectIds, expandedFolds, shown }),
    [collapsed, expandedFolds, mode, projectIds, shown, tree]
  )
  const content = useMemo(
    () => ({ width: layout.width, height: layout.height }),
    [layout.height, layout.width]
  )
  const viewport = useProjectMapViewport(content)
  const { view, size, fitSpan, panBy, centerOn, zoomBy, fit } = viewport
  const known = selectedId && (tree.bars.has(selectedId) || tree.lanes.has(selectedId))
  const selected = known ? selectedId : null
  const focus = useMemo(() => growthFocus(tree, selected), [selected, tree])
  const summaryTier = view.zoom < GROWTH_SUMMARY_ZOOM
  const summary = useMemo(
    () => (summaryTier ? buildGrowthSummary(shown, layout, filter) : null),
    [filter, layout, shown, summaryTier]
  )
  const cursorId = cursor && layout.bars.has(cursor) ? cursor : null
  const choose = useCallback(
    (id: string | null) => {
      setCursor(id)
      onSelect(id)
    },
    [onSelect]
  )
  const toggleFold = useCallback((from: number) => {
    setExpandedFolds((current) => {
      const next = new Set(current)
      if (!next.delete(from)) {
        next.add(from)
      }
      return next
    })
  }, [])

  const fitRecent = useCallback(() => {
    const from = layout.scale.xOf(tree.now - RECENT_FIT_MS)
    // A long history keeps a readable zoom and shows its newest part, so "now" is always in view.
    fitSpan(
      { x: from, width: layout.scale.xOf(tree.now) - from },
      { minZoom: READABLE_ZOOM, anchor: 'end', endPadding: NOW_ROOM_PX }
    )
  }, [fitSpan, layout.scale, tree.now])
  const projectKey = projectIds ? [...projectIds].sort().join('|') : '*'
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (active && size.width > 0 && fittedFor.current !== projectKey) {
      fittedFor.current = projectKey
      fitRecent()
    }
    // Fit once per project scope; later refreshes keep the person's pan and zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectKey, size.width])

  // Selecting never moves the view; only a detail panel that now covers the chat does, by the least.
  const viewRef = useRef(view)
  viewRef.current = view
  const selectedBox = selected ? layout.bars.get(selected) : undefined
  useEffect(() => {
    if (!active || !selectedBox || size.width === 0) {
      return
    }
    const { dx, dy } = growthRevealShift(selectedBox, viewRef.current, size)
    if (dx !== 0 || dy !== 0) {
      panBy(dx, dy)
    }
  }, [active, panBy, selectedBox, size])

  const toggleGroup = useCallback((projectId: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(projectId)) {
        next.add(projectId)
      }
      return next
    })
  }, [])

  const onPin = useCallback(
    (pin: GrowthLayoutPin) => {
      const target = pin.targets[0]
      const bar = target ? tree.bars.get(target) : undefined
      if (!bar) {
        return
      }
      const outside = projectIds !== null && !projectIds.has(bar.projectId)
      const nextCollapsed = new Set(collapsed)
      nextCollapsed.delete(bar.projectId)
      const next = layoutGrowthTree({
        tree,
        mode,
        collapsed: nextCollapsed,
        projectIds: outside ? null : projectIds,
        expandedFolds
      })
      const box = next.bars.get(bar.id)
      if (outside) {
        fittedFor.current = '*'
        onRevealProject(bar.projectId)
      }
      setCollapsed(nextCollapsed)
      if (box) {
        centerOn({ x: box.x, y: box.y, width: box.width, height: BAR_HEIGHT_FOR_CENTER })
      }
      choose(bar.id)
    },
    [centerOn, choose, collapsed, expandedFolds, mode, onRevealProject, projectIds, tree]
  )

  const jump = useCallback(
    (id: string) => {
      const bar = tree.bars.get(id)
      const lane = tree.lanes.get(id)
      const projectId = bar?.projectId ?? lane?.projectId
      if (projectId) {
        onJump({
          id,
          projectId,
          workspaceId: bar?.workspaceId ?? id,
          hideKey: bar?.hiddenInBlueprint
            ? (bar.agent.chat?.sessionId ?? bar.agent.card.paneKey)
            : null
        })
      }
    },
    [onJump, tree.bars, tree.lanes]
  )

  useGrowthTreeKeys({
    active,
    summary: summaryTier,
    layout,
    view,
    size,
    selected,
    cursor: cursorId,
    onCursor: setCursor,
    onSelect,
    onJump: jump,
    onFit: fitRecent,
    onZoom: zoomBy,
    onCenter: centerOn
  })

  const windowStart = growthWindowStart(filter.window, tree.now)
  const showAll = useCallback(() => {
    setFilter((current) => ({ ...current, window: 'all' }))
    fit()
  }, [fit])
  const empty = layout.groups.length === 0 || tree.bars.size === 0
  return (
    <section
      data-growth-tree=""
      data-window-start={windowStart ?? undefined}
      className={`${active ? 'flex' : 'hidden'} relative min-h-0 flex-1 flex-col`}
    >
      <GrowthTreeToolbar
        filter={filter}
        onFilter={setFilter}
        mode={mode}
        onMode={setMode}
        zoom={view.zoom}
        onZoom={zoomBy}
        onFit={fitRecent}
        onShowAll={showAll}
        replay={replayOpen}
        onReplay={() => {
          if (replayOpen) {
            replay.stop()
          }
          setReplayOpen(!replayOpen)
        }}
      />
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0">
            <div
              className="shrink-0 border-r border-b border-border"
              style={{ width: GROWTH_LABEL_WIDTH, height: GROWTH_RULER_HEIGHT }}
            />
            <GrowthTreeRuler layout={layout} view={view} onToggleFold={toggleFold} />
          </div>
          <div className="flex min-h-0 flex-1">
            <GrowthTreeLabels
              tree={tree}
              layout={layout}
              view={view}
              height={size.height}
              selectedId={selected}
              onSelectLane={choose}
              onJumpLane={jump}
              onToggleGroup={toggleGroup}
            />
            <div
              ref={viewport.viewportRef}
              data-growth-viewport=""
              onPointerDown={viewport.onBackgroundPointerDown}
              onClick={() => {
                if (!viewport.consumeDrag()) {
                  choose(null)
                }
              }}
              className="project-map-viewport relative min-w-0 flex-1 cursor-default overflow-clip"
            >
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{
                  width: layout.width,
                  height: layout.height,
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
                }}
              >
                <GrowthTreeWorld
                  tree={shown}
                  layout={layout}
                  selectedId={selected}
                  focus={focus}
                  filter={filter}
                  projectNames={projectNames}
                  summary={summary}
                  cursorId={cursorId}
                  zoom={view.zoom}
                  onSelect={choose}
                  onJump={jump}
                  onPin={onPin}
                  overlay={renderOverlay?.(layout.paths)}
                />
              </div>
              {empty ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex max-w-80 flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                    <Network aria-hidden className="size-6" />
                    {translate(
                      'growthTree.empty',
                      'Conversations appear here once a project has run an agent.'
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {selected ? (
          <GrowthTreeDock
            tree={tree}
            selectedId={selected}
            projectNames={projectNames}
            onClose={() => choose(null)}
            onLocate={jump}
            onOpenBar={onOpenBar}
            onOpenLane={onOpenLane}
          />
        ) : null}
      </div>
      {replayOpen ? (
        <GrowthTreeReplayBar
          at={replay.at ?? replay.range.to}
          position={replay.position}
          playing={replay.playing}
          speed={replay.speed}
          loading={replay.loading}
          hasEvents={replay.hasEvents}
          missingHosts={replay.coverage.missing}
          partialHosts={replay.coverage.partial}
          onPlay={replay.play}
          onPause={replay.pause}
          onSeek={replay.seek}
          onSpeed={replay.setSpeed}
        />
      ) : null}
    </section>
  )
}
