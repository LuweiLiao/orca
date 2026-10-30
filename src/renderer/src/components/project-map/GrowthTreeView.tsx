import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Network } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { GrowthTreeDock } from './GrowthTreeDock'
import { GrowthTreeReplayBar } from './GrowthTreeReplayBar'
import { GrowthTreeToolbar } from './GrowthTreeToolbar'
import { GrowthTreeWorld } from './GrowthTreeWorld'
import { GROWTH_EMPTY_FILTER, growthFocus, growthWindowStart } from './growth-tree-focus'
import { growthScrollToRow } from './growth-tree-keyboard-nav'
import {
  GROWTH_LAYOUT,
  layoutGrowthTree,
  type GrowthLayoutPin,
  type GrowthTreePathIndex
} from './growth-tree-layout'
import type { GrowthTree, GrowthTreeBar, GrowthTreeLane } from './growth-tree-types'
import { growthTreeAt } from './growth-tree-replay'
import { createFlowSignalBus, type FlowSignalBus } from './project-flow-signal'
import { useGrowthTreeKeys } from './use-growth-tree-keys'
import { useGrowthTreeReplay } from './use-growth-tree-replay'

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
  /** Live signals: what the overlay flies while replay is closed. */
  bus: FlowSignalBus
  /** Drawn over the wires in world coordinates, flying the signals of the bus it is given. */
  renderOverlay?: (paths: GrowthTreePathIndex, bus: FlowSignalBus) => React.ReactNode
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [filter, setFilter] = useState(GROWTH_EMPTY_FILTER)
  const [cursor, setCursor] = useState<string | null>(null)
  const [replayOpen, setReplayOpen] = useState(false)
  // Why: a replay flies only what it plays back; live work that happens meanwhile is not mixed in.
  const [replayBus] = useState(createFlowSignalBus)
  const replay = useGrowthTreeReplay({
    tree,
    enabled: replayOpen,
    bus: replayBus
  })
  const shown = useMemo(
    () => (replay.at === null ? tree : growthTreeAt(tree, replay.at)),
    [replay.at, tree]
  )
  const layout = useMemo(
    () => layoutGrowthTree({ tree, collapsed, projectIds, shown }),
    [collapsed, projectIds, shown, tree]
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const known = selectedId && (tree.bars.has(selectedId) || tree.lanes.has(selectedId))
  const selected = known ? selectedId : null
  const focus = useMemo(() => growthFocus(tree, selected), [selected, tree])
  const cursorId = cursor && layout.rows.has(cursor) ? cursor : null
  const choose = useCallback(
    (id: string | null) => {
      setCursor(id)
      onSelect(id)
    },
    [onSelect]
  )

  // A row to bring into view once it is laid out (a pin can first expand or reveal its project).
  const [pendingReveal, setPendingReveal] = useState<string | null>(null)
  const projectKey = projectIds ? [...projectIds].sort().join('|') : '*'
  const scrolledFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!active || !scroller) {
      return
    }
    const row = pendingReveal ? layout.rows.get(pendingReveal) : undefined
    if (row) {
      scrolledFor.current = projectKey
      setPendingReveal(null)
      scroller.scrollTop += growthScrollToRow(row, GROWTH_LAYOUT.rowHeight, {
        top: scroller.scrollTop,
        height: scroller.clientHeight
      })
    } else if (scrolledFor.current !== projectKey) {
      // Newest is on top: a new scope opens at the top; later refreshes keep the scroll.
      scrolledFor.current = projectKey
      scroller.scrollTop = 0
    }
  }, [active, layout, pendingReveal, projectKey])

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
      if (projectIds !== null && !projectIds.has(bar.projectId)) {
        onRevealProject(bar.projectId)
      }
      setCollapsed((current) => {
        const next = new Set(current)
        next.delete(bar.projectId)
        return next
      })
      setPendingReveal(bar.id)
      choose(bar.id)
    },
    [choose, onRevealProject, projectIds, tree.bars]
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
    layout,
    selected,
    cursor: cursorId,
    onCursor: setCursor,
    onSelect,
    onJump: jump,
    onReveal: setPendingReveal
  })

  // A selection made elsewhere (the blueprint, a pin) is brought into view.
  useEffect(() => {
    if (selected && layout.rows.has(selected)) {
      setPendingReveal(selected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const windowStart = growthWindowStart(filter.window, tree.now)
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
        replay={replayOpen}
        onReplay={() => {
          if (replayOpen) {
            replay.stop()
          }
          setReplayOpen(!replayOpen)
        }}
      />
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={scrollRef}
          data-growth-viewport=""
          onClick={() => choose(null)}
          className="scrollbar-sleek relative min-w-0 flex-1 overflow-auto bg-background"
        >
          <GrowthTreeWorld
            tree={shown}
            layout={layout}
            selectedId={selected}
            focus={focus}
            filter={filter}
            projectNames={projectNames}
            cursorId={cursorId}
            onSelect={choose}
            onJump={jump}
            onPin={onPin}
            onToggleGroup={toggleGroup}
            overlay={renderOverlay?.(layout.paths, replayOpen ? replayBus : bus)}
          />
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
