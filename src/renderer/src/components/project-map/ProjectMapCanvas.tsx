import { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
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
import { projectMapNodeReferences } from './project-map-node-references'
import { useProjectMapReferenceDrop } from './use-project-map-reference-drop'
import { ProjectMapLegend } from './ProjectMapLegend'
import {
  ProjectMapDraftGhost,
  ProjectMapForkHandle,
  ProjectMapMergeHandle
} from './ProjectMapForkHandle'
import { ProjectMapComparePanel } from './ProjectMapComparePanel'
import { useProjectMapMergePicks } from './use-project-map-merge-picks'
import { useProjectMapAwaitedChild, useProjectMapEscape } from './use-project-map-canvas-selection'
import { ProjectMapForkWindow, type ProjectMapForkIntent } from './ProjectMapForkWindow'
import { useProjectMapForkDrag, useProjectMapHover } from './use-project-map-fork-drag'
import type { ProjectMapCollapsedView } from './project-map-collapse'
import { ProjectMapSelectionWindow } from './ProjectMapSelectionWindow'
import {
  projectMapAgentForkable,
  projectMapLinkedNodes,
  projectMapWindowSubject
} from './project-map-window-subject'
import {
  projectMapDraftRect,
  projectMapViewportRect,
  type ProjectMapRect
} from './project-map-window-placement'
import { projectMapDropSlot } from './project-map-drop-slot'
import { noteProjectMapChatRow } from './project-map-chat-rows'
import { useProjectMapKeyboard } from './use-project-map-keyboard'
import { useProjectMapRowMoves } from './use-project-map-row-moves'
import { projectMapDeleteKey, useProjectMapNodeCommands } from './use-project-map-node-commands'

type Props = {
  /** Every chat on the map, the hidden ones in stacks included. */
  graph: ProjectMapGraph
  /** What is drawn: `graph` with busy parents' delegated chats folded into stacks. */
  collapsed: ProjectMapCollapsedView
  layout: ProjectMapLayout
  viewport: ReturnType<typeof useProjectMapViewport>
  activeWorktreeId: string | null
  onOpenAgent: (agent: ProjectMapAgent) => void
  onOpenWorkspace: (workspace: ProjectMapWorkspace) => void
  /** Show a stacked parent's chats on the canvas, or fold them back. */
  onToggleCollapse: (parentPaneKey: string) => void
  /** Hosts known to predate forks. */
  forkUnsupportedHosts: ReadonlySet<string>
  /** A fork made a chat; its lineage is worth reading again. */
  onForked: () => void
  searchOpen: boolean
  onSearchOpenChange: (open: boolean) => void
}

const EMPTY_WORKTREES: readonly Worktree[] = []

type CssVariables = React.CSSProperties & Record<`--${string}`, string | number>

export function ProjectMapCanvas({
  graph,
  collapsed,
  layout,
  viewport,
  activeWorktreeId,
  onOpenAgent,
  onOpenWorkspace,
  forkUnsupportedHosts,
  onToggleCollapse,
  onForked,
  searchOpen,
  onSearchOpenChange
}: Props): React.JSX.Element {
  const { view } = viewport
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The chat a new child is being made from: one chat, a turn on its timeline, or a merge.
  const [fork, setFork] = useState<ProjectMapForkIntent | null>(null)
  const forkFor = fork?.paneKey ?? null
  const setForkFor = useCallback(
    (paneKey: string | null) => setFork(paneKey ? { paneKey } : null),
    []
  )
  const worktrees = useAppStore((s) => selectWorktreesByRepo(s)[graph.projectId] ?? EMPTY_WORKTREES)
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
  // A node that vanished (agent closed, project switched) takes its window with it.
  const selected = selectedId && shownAs(selectedId) ? selectedId : null
  const selectedShown = selected ? shownAs(selected) : null
  const forkOrigin = forkFor === selected && selected ? graph.agents.get(selected) : undefined
  const { enter: hoverEnter, leave: hoverLeave, hovered } = useProjectMapHover()
  const hoverNode = useCallback(
    (id: string | null) => (id ? hoverEnter(id) : hoverLeave()),
    [hoverEnter, hoverLeave]
  )
  const forkDrag = useProjectMapForkDrag({
    contentPoint: viewport.contentPoint,
    snap: (originId, pointerY) => projectMapDropSlot(layout, graph, originId, pointerY),
    onStart: () => setForkFor(null),
    onPlace: (originId, merge) => {
      setSelectedId(originId)
      setFork({ paneKey: originId, ...(merge ? { merge } : {}) })
    }
  })
  const picks = useProjectMapMergePicks(graph, layout)
  const { clear: clearPicks } = picks
  const awaitChild = useProjectMapAwaitedChild(graph, (id) => shownAs(id) !== null, setSelectedId)
  const dropSelection = useCallback(() => {
    setSelectedId(null)
    clearPicks()
  }, [clearPicks])
  useProjectMapEscape(selected !== null || picks.picked.length > 0, dropSelection)
  const rowMoves = useProjectMapRowMoves(graph, layout)
  const commands = useProjectMapNodeCommands(graph)
  const merging = picks.picked.length >= 2
  const [compare, setCompare] = useState<readonly [string, string] | null>(null)
  const [first, second, extra] = picks.picked
  const pair = first && second && !extra ? ([first, second] as const) : null
  const comparing = compare?.map((id) => graph.agents.get(id))
  // Shift, ⌘ or Ctrl adds a chat to a merge; a plain click drops the merge and opens the chat.
  const selectNode = (id: string, adding?: boolean): void => {
    if (adding) {
      picks.toggle(id, selected)
      setSelectedId(null)
      setFork(null)
      return
    }
    picks.clear()
    setSelectedId(id)
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
  const handleFor = merging
    ? null
    : forkDrag.pressed
      ? forkable(forkDrag.pressed)
      : (forkable(hovered) ?? (selected === selectedShown ? forkable(selected) : null))
  const handleBox = handleFor ? layout.nodes.get(handleFor) : undefined
  const group = selectedShown ? collapsed.groups.get(selectedShown) : undefined
  const trayOpen = group !== undefined && selected === selectedShown

  const linked = useMemo(
    () => projectMapLinkedNodes(collapsed.graph.edges, selectedShown),
    [collapsed.graph.edges, selectedShown]
  )

  const referencesOf = useMemo(
    () => projectMapNodeReferences(collapsed.graph.agents, layout.wires),
    [collapsed.graph.agents, layout.wires]
  )

  const dropReference = useProjectMapReferenceDrop(
    graph,
    useCallback((target: string) => {
      setFork(null)
      setSelectedId(target)
    }, [])
  )

  const toViewport = (id: string): ProjectMapRect | null => {
    const box = layout.nodes.get(id)
    return box ? projectMapViewportRect(box, view) : null
  }
  const { locate, match } = useProjectMapLocate({
    layout,
    viewport,
    shownAs,
    select: setSelectedId
  })
  const openNodeAt = (event: React.MouseEvent): void => {
    const id = projectMapNodeIdOf(event.target) ?? ''
    const [agent, workspace] = [graph.agents.get(id), graph.workspaces.get(id)]
    return agent ? onOpenAgent(agent) : workspace ? onOpenWorkspace(workspace) : undefined
  }
  const subject = projectMapWindowSubject(graph, selected)
  const keyboard = useProjectMapKeyboard({
    graph,
    layout,
    viewport,
    selected,
    open: selectNode,
    togglePick: (id) => selectNode(id, true),
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
          picks.clear()
        }
      }}
      className="project-map-viewport relative min-h-0 flex-1 cursor-default overflow-hidden outline-none"
      style={viewportStyle}
    >
      <ProjectMapCanvasMenu
        graph={graph}
        collapsed={collapsed}
        forkUnsupportedHosts={forkUnsupportedHosts}
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
            <ProjectMapNodeLayer
              graph={graph}
              collapsed={collapsed}
              layout={layout}
              selectedShown={selectedShown}
              linked={linked}
              activeWorktreeId={activeWorktreeId}
              worktreeById={worktreeById}
              referencesOf={referencesOf}
              onSelect={selectNode}
              picked={picks.picked}
              onHover={hoverNode}
              onReferenceDrop={dropReference}
            />
            {handleFor && handleBox ? (
              <ProjectMapForkHandle
                box={handleBox}
                open={forkOrigin !== undefined && forkFor === handleFor}
                unsupported={forkUnsupportedHosts.has(
                  graph.agents.get(handleFor)?.chat?.executionHostId ?? ''
                )}
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
            {/* Mounted through its own drag: the press that holds the pointer must see it let go. */}
            {merging && !fork?.merge ? (
              <ProjectMapMergeHandle
                boxes={picks.picked.flatMap((id) => layout.nodes.get(id) ?? [])}
                onPointerDown={(event) =>
                  forkDrag.onHandlePointerDown(picks.picked[0]!, event, picks.picked.slice(1))
                }
                onOpen={() => {
                  if (!forkDrag.consumeDrag()) {
                    setSelectedId(picks.picked[0]!)
                    setFork({ paneKey: picks.picked[0]!, merge: picks.picked.slice(1) })
                  }
                }}
                onCompare={pair ? () => setCompare(pair) : undefined}
              />
            ) : null}
            <ProjectMapDraftGhost draft={draft} layout={layout} graph={graph} />
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
      {forkOrigin && anchor && fork ? (
        <ProjectMapForkWindow
          key={`fork:${selected}:${placedDraft ? 'placed' : (fork.at?.itemId ?? fork.merge?.join() ?? 'node')}`}
          intent={fork}
          origin={forkOrigin}
          agents={graph.agents}
          anchor={anchor}
          viewport={viewport.size}
          avoid={[
            ...linked,
            ...(placedDraft ? [placedDraft.originId] : []),
            ...(fork.merge ?? [])
          ].flatMap((id) => toViewport(id) ?? [])}
          onClose={() => setForkFor(null)}
          onCreated={({ sessionId }) => {
            if (placedDraft) {
              noteProjectMapChatRow(sessionId, placedDraft.row)
            }
            setForkFor(null)
            picks.clear()
            awaitChild(sessionId)
            onForked()
          }}
        />
      ) : anchor && (trayOpen || subject) ? (
        <ProjectMapSelectionWindow
          graph={graph}
          collapsed={collapsed}
          selected={selected}
          subject={subject}
          group={trayOpen ? group : undefined}
          anchor={anchor}
          viewport={viewport.size}
          avoid={[...linked].flatMap((id) => toViewport(id) ?? [])}
          forkUnsupportedHosts={forkUnsupportedHosts}
          onSelect={setSelectedId}
          onOpenAgent={onOpenAgent}
          onOpenWorkspace={onOpenWorkspace}
          onToggleCollapse={onToggleCollapse}
          onFork={setFork}
        />
      ) : null}
      {comparing?.[0] && comparing[1] ? (
        <ProjectMapComparePanel
          pair={[comparing[0], comparing[1]]}
          onSelectNode={locate}
          onClose={() => setCompare(null)}
        />
      ) : null}
      <ProjectMapLegend />
    </div>
  )
}
