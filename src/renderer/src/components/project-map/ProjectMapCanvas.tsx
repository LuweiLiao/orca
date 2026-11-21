import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import type { ProjectMapAgent, ProjectMapGraph, ProjectMapWorkspace } from './project-map-graph'
import type { ProjectMapLayout } from './project-map-layout'
import type { useProjectMapViewport } from './use-project-map-viewport'
import { ProjectMapNodeLayer } from './ProjectMapNodeLayer'
import { ProjectMapCanvasMenu } from './ProjectMapCanvasMenu'
import { ProjectMapSearch } from './ProjectMapSearch'
import { ProjectMapNodeOverlays } from './ProjectMapNodeOverlays'
import { ProjectMapBackdrop } from './ProjectMapBackdrop'
import { projectMapNodeIdOf } from './project-map-node-target'
import { useProjectMapLocate } from './use-project-map-locate'
import type { Worktree } from '../../../../shared/worktree/types'
import { ProjectFlowOverlay } from './ProjectFlowOverlay'
import type { FlowSignal, FlowSignalBus } from './project-flow-signal'
import type { FlowRoute } from './project-flow-particles'
import { resolveFlowRoute } from './project-flow-wire-route'
import { useProjectMapForkable } from './project-map-native-fork'
import { ProjectMapLegend } from './ProjectMapLegend'
import {
  ProjectMapForkGhost,
  ProjectMapForkHandle,
  projectMapForkPin
} from './ProjectMapForkHandle'
import { useProjectMapForkDrag, useProjectMapHover } from './use-project-map-fork-drag'
import type { ProjectMapCollapsedView } from './project-map-collapse'
import { projectMapAgentTitle } from './project-map-labels'
import { ProjectMapNodeWindows } from './ProjectMapNodeWindows'
import { useProjectMapOpenWindows } from './use-project-map-open-windows'
import { projectMapAgentForkable } from './project-map-window-subject'
import { ProjectMapForkPanel } from './ProjectMapForkPanel'
import {
  projectMapDraftRect,
  projectMapViewportRect,
  type ProjectMapRect
} from './project-map-window-placement'
import { useProjectMapKeyboard } from './use-project-map-keyboard'
import { useProjectMapRowMoves } from './use-project-map-row-moves'
import { projectMapDropSlot } from './project-map-drop-slot'
import { noteProjectMapChatRow } from './project-map-chat-rows'
import { useProjectMapReferenceDrop } from './use-project-map-reference-drop'
import { projectMapDeleteKey, useProjectMapNodeCommands } from './use-project-map-node-commands'

type Props = {
  /** Every chat on the map, the hidden ones in stacks included. */
  graph: ProjectMapGraph
  /** What is drawn: `graph` with busy parents' delegated chats folded into stacks. */
  collapsed: ProjectMapCollapsedView
  layout: ProjectMapLayout
  /** Real delegations and reports, flown once along the wire between their two chats. */
  flowBus: FlowSignalBus
  viewport: ReturnType<typeof useProjectMapViewport>
  activeWorktreeId: string | null
  onOpenAgent: (agent: ProjectMapAgent) => void
  onOpenWorkspace: (workspace: ProjectMapWorkspace) => void
  /** Show a stacked parent's chats on the canvas, or fold them back. */
  onToggleCollapse: (parentPaneKey: string) => void
  searchOpen: boolean
  onSearchOpenChange: (open: boolean) => void
  /** Selected when the canvas mounts, so a view switch keeps the selection. */
  initialSelectedId?: string | null
  onSelectionChange?: (id: string | null) => void
  /** Centers and selects a node once, as the growth tree's jump asks. */
  locateRequest?: { id: string; nonce: number } | null
}

const AWAIT_FORKED_CHAT_MS = 30_000
const EMPTY_WORKTREES: readonly Worktree[] = []

type CssVariables = React.CSSProperties & Record<`--${string}`, string | number>

export function ProjectMapCanvas({
  graph,
  collapsed,
  layout,
  flowBus,
  viewport,
  activeWorktreeId,
  onOpenAgent,
  onOpenWorkspace,
  onToggleCollapse,
  searchOpen,
  onSearchOpenChange,
  initialSelectedId = null,
  onSelectionChange,
  locateRequest
}: Props): React.JSX.Element {
  const { view } = viewport
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const windows = useProjectMapOpenWindows(viewport.element, setSelectedId)
  const [forkFor, setForkFor] = useState<string | null>(null)
  // A new child shows up on a later snapshot; select it then, by its chat's session.
  const [awaited, setAwaited] = useState<{ sessionId: string; projectId: string } | null>(null)
  // Waited for only on the project it was made from, and not forever: a child that lands
  // elsewhere, or never shows, must not grab the selection later.
  const awaitedSession = awaited?.projectId === graph.projectId ? awaited.sessionId : null
  useEffect(() => {
    if (!awaited) {
      return
    }
    const timer = window.setTimeout(() => setAwaited(null), AWAIT_FORKED_CHAT_MS)
    return () => window.clearTimeout(timer)
  }, [awaited])
  const worktrees = useAppStore((s) => s.worktreesByRepo[graph.projectId] ?? EMPTY_WORKTREES)
  const worktreeById = useMemo(
    () => new Map(worktrees.map((worktree) => [worktree.id, worktree])),
    [worktrees]
  )
  const branchOf = useCallback(
    (id: string) => worktreeById.get(id)?.branch.replace(/^refs\/heads\//, '') ?? null,
    [worktreeById]
  )
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // A chat folded into a stack is shown, and wired, through the stack.
  const shownAs = (id: string): string | null =>
    layout.nodes.has(id) ? id : (collapsed.groupOf.get(id) ?? null)
  // A window goes with its node, adjusted in render so it never outlives it by a frame.
  windows.keepShown((id) => shownAs(id) !== null)
  // A node that vanished (agent closed, project switched) drops out of the selection.
  const selected = selectedId && shownAs(selectedId) ? selectedId : null
  const selectedShown = selected ? shownAs(selected) : null
  // Hidden where the host or agent cannot fork natively; nothing to refuse then.
  const selectedForkable = useProjectMapForkable(selected ? graph.agents.get(selected) : undefined)
  const forkOrigin =
    selectedForkable && forkFor === selected && selected ? graph.agents.get(selected) : undefined
  const { enter: hoverEnter, leave: hoverLeave, hovered } = useProjectMapHover()
  const hoverNode = useCallback(
    (id: string | null) => (id ? hoverEnter(id) : hoverLeave()),
    [hoverEnter, hoverLeave]
  )
  const forkDrag = useProjectMapForkDrag({
    contentPoint: viewport.contentPoint,
    snap: (originId, pointerY) => projectMapDropSlot(layout, graph, originId, pointerY),
    onStart: () => setForkFor(null),
    onPlace: (originId) => {
      setSelectedId(originId)
      setForkFor(originId)
    }
  })
  const dropSelection = useCallback(() => setSelectedId(null), [])
  const dropReference = useProjectMapReferenceDrop(
    graph,
    useCallback(
      (target: string) => {
        setForkFor(null)
        windows.open(target)
      },
      [windows]
    )
  )
  const rowMoves = useProjectMapRowMoves(graph, layout)
  const commands = useProjectMapNodeCommands(graph)
  // A plain click opens its window, a second one closes it.
  const toggleNode = (id: string): void => {
    if (windows.toggle(id) === 'closed' && forkFor === id) {
      setForkFor(null)
    }
  }
  const { draft } = forkDrag
  // A placed child lives only while its panel is open; closing or creating drops it.
  if (draft?.placed && (forkFor !== draft.originId || !forkOrigin)) {
    forkDrag.clearDraft()
  }
  const placedDraft = draft?.placed && forkOrigin ? draft : null
  const forkable = (id: string | null): string | null =>
    id && layout.nodes.has(id) && projectMapAgentForkable(graph.agents.get(id)) ? id : null
  // One handle at a time: the one in use, else under the pointer, else on the selected node.
  const handleFor = forkDrag.pressed
    ? forkable(forkDrag.pressed)
    : (forkable(hovered) ?? (selected === selectedShown ? forkable(selected) : null))
  // Shown on every structured chat, disabled where its host or agent cannot fork natively.
  const handleForkable = useProjectMapForkable(handleFor ? graph.agents.get(handleFor) : undefined)
  const handleBox = handleFor ? layout.nodes.get(handleFor) : undefined
  const draftFrom = draft ? layout.nodes.get(draft.originId) : undefined
  const draftOrigin = draft ? graph.agents.get(draft.originId) : undefined

  // Adjusted during render, not in an effect, so the new node never draws unselected first.
  const arrived = awaitedSession
    ? [...graph.agents.values()].find((agent) => agent.chat?.sessionId === awaitedSession)
    : undefined
  if (arrived && shownAs(arrived.card.paneKey)) {
    windows.open(arrived.card.paneKey)
    setAwaited(null)
  }

  const linked = useMemo(() => {
    const ids = new Set<string>()
    for (const edge of collapsed.graph.edges) {
      if (edge.from === selectedShown) {
        ids.add(edge.to)
      } else if (edge.to === selectedShown) {
        ids.add(edge.from)
      }
    }
    return ids
  }, [collapsed.graph.edges, selectedShown])

  useEffect(() => {
    if (!selected) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !(event.target instanceof Element && event.target.closest('[data-project-map-window]'))
      ) {
        setSelectedId(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selected])

  const toViewport = (id: string): ProjectMapRect | null => {
    const box = layout.nodes.get(id)
    return box ? projectMapViewportRect(box, view) : null
  }
  const resolveFlow = (signal: FlowSignal): FlowRoute | null => {
    const [from, to] = [shownAs(signal.from), shownAs(signal.to)]
    return from && to
      ? resolveFlowRoute(layout.wires, from, to, { handoff: signal.tone === 'handoff' })
      : null
  }
  const { locate, match } = useProjectMapLocate({
    layout,
    viewport,
    shownAs,
    select: windows.open
  })
  const handledLocate = useRef(0)
  const viewportWidth = viewport.size.width
  useEffect(() => {
    if (locateRequest && locateRequest.nonce !== handledLocate.current && viewportWidth > 0) {
      handledLocate.current = locateRequest.nonce
      locate(locateRequest.id)
    }
  }, [locate, locateRequest, viewportWidth])
  const reported = useRef(selected)
  useEffect(() => {
    if (reported.current !== selected) {
      reported.current = selected
      onSelectionChange?.(selected)
    }
  }, [onSelectionChange, selected])
  const openNodeAt = (event: React.MouseEvent): void => {
    const id = projectMapNodeIdOf(event.target) ?? ''
    const [agent, workspace] = [graph.agents.get(id), graph.workspaces.get(id)]
    return agent ? onOpenAgent(agent) : workspace ? onOpenWorkspace(workspace) : undefined
  }
  const keyboard = useProjectMapKeyboard({
    graph,
    layout,
    viewport,
    selected,
    open: windows.open,
    onOpenAgent,
    onOpenWorkspace,
    onRename: setRenamingId,
    onMoveRow: (paneKey, direction) => void rowMoves.move(paneKey, direction),
    onEscape: dropSelection,
    onDelete: (id) => projectMapDeleteKey(graph, id, commands)
  })
  // The grid background pans and scales with the content.
  const viewportStyle: CssVariables = {
    '--pm-zoom': view.zoom,
    '--pm-pan-x': `${view.x}px`,
    '--pm-pan-y': `${view.y}px`
  }
  const anchor = placedDraft
    ? projectMapDraftRect(placedDraft.point, view)
    : selectedShown
      ? toViewport(selectedShown)
      : null

  return (
    <div
      ref={viewport.viewportRef}
      data-focusing={selected !== null}
      data-project-map-canvas=""
      tabIndex={0}
      onKeyDown={keyboard.onKeyDown}
      onKeyUp={keyboard.onKeyUp}
      data-fork-dragging={forkDrag.dragging || undefined}
      onPointerDown={viewport.onBackgroundPointerDown}
      onClick={() => {
        if (!viewport.consumeDrag()) {
          keyboard.clearCursor()
          setSelectedId(null)
          setForkFor(null)
        }
      }}
      className="project-map-viewport relative min-h-0 flex-1 cursor-default overflow-hidden outline-none"
      style={viewportStyle}
    >
      <ProjectMapCanvasMenu
        graph={graph}
        collapsed={collapsed}
        onOpenAgent={onOpenAgent}
        onNewChild={(paneKey) => {
          setSelectedId(paneKey)
          setForkFor(paneKey)
        }}
        onRename={setRenamingId}
        onFit={viewport.fit}
        onSearch={() => onSearchOpenChange(true)}
        rowMoves={rowMoves}
      >
        <div className="absolute inset-0">
          <div
            data-project-map-content=""
            onDoubleClick={openNodeAt}
            className="absolute top-0 left-0 origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
            }}
          >
            <ProjectMapBackdrop
              layout={layout}
              activeWorktreeId={activeWorktreeId}
              selectedShown={selectedShown}
            />
            <ProjectFlowOverlay bus={flowBus} resolve={resolveFlow} />
            <ProjectMapNodeLayer
              graph={graph}
              collapsed={collapsed}
              layout={layout}
              selectedShown={selectedShown}
              linked={linked}
              activeWorktreeId={activeWorktreeId}
              worktreeById={worktreeById}
              onSelect={toggleNode}
              onHover={hoverNode}
              onReferenceDrop={dropReference}
            />
            {handleFor && handleBox ? (
              <ProjectMapForkHandle
                box={handleBox}
                open={forkOrigin !== undefined && forkFor === handleFor}
                unsupported={!handleForkable}
                onPointerDown={(event) => forkDrag.onHandlePointerDown(handleFor, event)}
                onHover={(inside) => (inside ? hoverEnter(handleFor) : hoverLeave())}
                onOpen={() => {
                  if (!forkDrag.consumeDrag()) {
                    setSelectedId(handleFor)
                    setForkFor(handleFor)
                  }
                }}
              />
            ) : null}
            {draft && draftFrom && draftOrigin ? (
              <ProjectMapForkGhost
                from={projectMapForkPin(draftFrom)}
                draft={draft}
                originTitle={projectMapAgentTitle(draftOrigin.card)}
              />
            ) : null}
            <ProjectMapNodeOverlays
              layout={layout}
              agents={graph.agents}
              renamingId={renamingId}
              onRenameEnd={() => setRenamingId(null)}
              match={match}
              cursorId={keyboard.cursor}
            />
          </div>
        </div>
      </ProjectMapCanvasMenu>
      {searchOpen ? (
        <ProjectMapSearch
          graph={graph}
          branchOf={branchOf}
          onPick={locate}
          onClose={() => onSearchOpenChange(false)}
        />
      ) : null}
      {forkOrigin && anchor ? (
        <ProjectMapForkPanel
          key={`fork:${selected}:${placedDraft ? 'placed' : 'node'}`}
          origin={forkOrigin}
          agents={graph.agents}
          anchor={anchor}
          viewport={viewport.size}
          avoid={[...linked, ...(placedDraft ? [placedDraft.originId] : [])].flatMap(
            (id) => toViewport(id) ?? []
          )}
          onClose={() => setForkFor(null)}
          onCreated={({ sessionId }) => {
            if (placedDraft) {
              noteProjectMapChatRow(sessionId, placedDraft.row)
            }
            setForkFor(null)
            setAwaited({ sessionId, projectId: graph.projectId })
          }}
        />
      ) : null}
      <ProjectMapNodeWindows
        graph={graph}
        collapsed={collapsed}
        windows={windows}
        shownAs={shownAs}
        toViewport={toViewport}
        viewport={viewport.size}
        forkFor={forkOrigin ? forkFor : null}
        onOpenAgent={onOpenAgent}
        onOpenWorkspace={onOpenWorkspace}
        onToggleCollapse={onToggleCollapse}
        onFork={setForkFor}
      />
      <ProjectMapLegend />
    </div>
  )
}
