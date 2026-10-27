import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import type { ProjectMapAgent, ProjectMapGraph, ProjectMapWorkspace } from './project-map-graph'
import { PROJECT_MAP_NODE, type ProjectMapLayout } from './project-map-layout'
import type { useProjectMapViewport } from './use-project-map-viewport'
import { ProjectMapAgentNode, ProjectMapWorkspaceNode } from './ProjectMapNode'
import { ProjectMapGroupNode } from './ProjectMapGroupNode'
import { projectMapNodeReferences } from './project-map-node-references'
import { insertReferenceInMapWindow } from './project-map-reference-drop'
import type { ConversationReferenceCreate } from '../../../../shared/conversation-reference'
import { ProjectMapGroupTray } from './ProjectMapGroupTray'
import { ProjectMapLegend } from './ProjectMapLegend'
import {
  ProjectMapForkGhost,
  ProjectMapForkHandle,
  projectMapForkPin
} from './ProjectMapForkHandle'
import { useProjectMapForkDrag, useProjectMapHover } from './use-project-map-fork-drag'
import { PROJECT_MAP_GROUP_PREFIX, type ProjectMapCollapsedView } from './project-map-collapse'
import { projectMapAgentTitle } from './project-map-labels'
import { ProjectMapChatWindow } from './ProjectMapChatWindow'
import { projectMapAgentForkable, projectMapWindowSubject } from './project-map-window-subject'
import { ProjectMapForkPanel } from './ProjectMapForkPanel'
import type { ProjectMapRect } from './project-map-window-placement'

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
}

const AWAIT_FORKED_CHAT_MS = 30_000
const PROJECT_MAP_CHAT_WINDOW = '[data-project-map-chat-window]'

const EMPTY_WORKTREES: readonly { id: string; branch: string }[] = []

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
  onForked
}: Props): React.JSX.Element {
  const { view } = viewport
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
  const worktrees = useAppStore((s) => selectWorktreesByRepo(s)[graph.projectId] ?? EMPTY_WORKTREES)
  const branchById = useMemo(
    () =>
      new Map(
        worktrees.map((worktree) => [worktree.id, worktree.branch.replace(/^refs\/heads\//, '')])
      ),
    [worktrees]
  )
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
    onStart: () => setForkFor(null),
    onPlace: (originId) => {
      setSelectedId(originId)
      setForkFor(originId)
    }
  })
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
  const handleBox = handleFor ? layout.nodes.get(handleFor) : undefined
  const draftFrom = draft ? layout.nodes.get(draft.originId) : undefined
  const draftOrigin = draft ? graph.agents.get(draft.originId) : undefined
  const group = selectedShown ? collapsed.groups.get(selectedShown) : undefined
  const trayOpen = group !== undefined && selected === selectedShown

  // Adjusted during render, not in an effect, so the new node never draws unselected first.
  const arrived = awaitedSession
    ? [...graph.agents.values()].find((agent) => agent.chat?.sessionId === awaitedSession)
    : undefined
  if (arrived && shownAs(arrived.card.paneKey)) {
    setSelectedId(arrived.card.paneKey)
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

  const referencesOf = useMemo(
    () => projectMapNodeReferences(collapsed.graph.agents, layout.wires),
    [collapsed.graph.agents, layout.wires]
  )

  // Opens the chat a reference was dropped on and puts the reference in its message box.
  const dropReference = useCallback(
    (target: string, source: ConversationReferenceCreate) => {
      const chat = graph.agents.get(target)?.chat
      if (source.source.kind === 'structured' && source.source.sessionId === chat?.sessionId) {
        return
      }
      setForkFor(null)
      setSelectedId(target)
      void insertReferenceInMapWindow(PROJECT_MAP_CHAT_WINDOW, source)
    },
    [graph.agents]
  )

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
    return box
      ? {
          x: box.x * view.zoom + view.x,
          y: box.y * view.zoom + view.y,
          width: box.width * view.zoom,
          height: PROJECT_MAP_NODE.height * view.zoom
        }
      : null
  }
  const subject = projectMapWindowSubject(graph, selected)
  // The grid background pans and scales with the content.
  const viewportStyle: CssVariables = {
    '--pm-zoom': view.zoom,
    '--pm-pan-x': `${view.x}px`,
    '--pm-pan-y': `${view.y}px`
  }
  const anchor = placedDraft
    ? {
        x: placedDraft.point.x * view.zoom + view.x,
        y: (placedDraft.point.y - PROJECT_MAP_NODE.headerPinOffsetY) * view.zoom + view.y,
        width: PROJECT_MAP_NODE.agentWidth * view.zoom,
        height: PROJECT_MAP_NODE.height * view.zoom
      }
    : selectedShown
      ? toViewport(selectedShown)
      : null

  return (
    <div
      ref={viewport.viewportRef}
      data-focusing={selected !== null}
      data-project-map-canvas=""
      data-fork-dragging={forkDrag.dragging || undefined}
      onPointerDown={viewport.onBackgroundPointerDown}
      onClick={() => {
        if (!viewport.consumeDrag()) {
          setSelectedId(null)
          setForkFor(null)
        }
      }}
      className="project-map-viewport relative min-h-0 flex-1 cursor-default overflow-hidden"
      style={viewportStyle}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
        }}
      >
        {layout.lanes.map((lane) => (
          <div
            key={lane.workspaceId}
            aria-hidden
            data-current={lane.workspaceId === activeWorktreeId}
            className="project-map-lane absolute"
            style={{
              left: lane.x,
              top: lane.y,
              width: layout.width - lane.x - 16,
              height: lane.height
            }}
          />
        ))}
        {layout.looseGroup ? (
          <div
            className="project-map-loose absolute"
            style={{
              left: 16,
              right: 16,
              top: layout.looseGroup.y,
              height: layout.looseGroup.height
            }}
          >
            <span className="absolute top-1.5 left-3 text-[11px] font-semibold tracking-wide text-muted-foreground">
              {translate('projectMap.looseGroup', 'No lineage or conversations')}
            </span>
          </div>
        ) : null}
        <svg
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          width={layout.width}
          height={layout.height}
        >
          {layout.wires.map((wire) => {
            const highlighted = wire.from === selectedShown || wire.to === selectedShown
            // A backward reference would cross the map; it shows only beside its selected end.
            return wire.backward && !highlighted ? null : (
              <path
                key={`${wire.kind}:${wire.from}:${wire.to}`}
                className="project-map-wire"
                data-kind={wire.kind}
                data-live={wire.live || undefined}
                data-highlighted={highlighted}
                d={wire.path}
              />
            )
          })}
        </svg>
        {[...layout.nodes.values()].map((box) => {
          const workspace = graph.workspaces.get(box.id)
          const agent = collapsed.graph.agents.get(box.id)
          const stack = collapsed.groups.get(box.id)
          const common = {
            box,
            selected: box.id === selectedShown,
            linked: linked.has(box.id),
            onSelect: setSelectedId
          }
          return workspace ? (
            <ProjectMapWorkspaceNode
              key={box.id}
              {...common}
              workspace={workspace}
              branch={branchById.get(box.id) ?? null}
              current={box.id === activeWorktreeId}
            />
          ) : stack ? (
            <ProjectMapGroupNode
              key={box.id}
              {...common}
              group={stack}
              forksOut={(agent?.childPaneKeys.length ?? 0) > 0}
            />
          ) : agent ? (
            <ProjectMapAgentNode
              key={box.id}
              {...common}
              // The real chat, so a stacked parent still counts every chat it delegated.
              agent={graph.agents.get(box.id) ?? agent}
              references={referencesOf.get(box.id)}
              onReferenceDrop={dropReference}
              onHover={hoverNode}
              graphAgents={graph.agents}
            />
          ) : null
        })}
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
        {draft && draftFrom && draftOrigin ? (
          <ProjectMapForkGhost
            from={projectMapForkPin(draftFrom)}
            draft={draft}
            originTitle={projectMapAgentTitle(draftOrigin.card)}
          />
        ) : null}
      </div>
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
            setForkFor(null)
            setAwaited({ sessionId, projectId: graph.projectId })
            onForked()
          }}
        />
      ) : trayOpen && group && anchor ? (
        <ProjectMapGroupTray
          key={group.id}
          group={group}
          parentTitle={projectMapAgentTitle(
            graph.agents.get(group.parentPaneKey)?.card ??
              collapsed.graph.agents.get(group.id)!.card
          )}
          agents={graph.agents}
          anchor={anchor}
          viewport={viewport.size}
          avoid={[...linked].flatMap((id) => toViewport(id) ?? [])}
          onClose={() => setSelectedId(null)}
          onOpenMember={setSelectedId}
          onExpand={() => {
            setSelectedId(group.parentPaneKey)
            onToggleCollapse(group.parentPaneKey)
          }}
        />
      ) : subject && anchor ? (
        <ProjectMapChatWindow
          key={selected}
          subject={subject}
          anchor={anchor}
          viewport={viewport.size}
          avoid={[...linked].flatMap((id) => toViewport(id) ?? [])}
          onClose={() => setSelectedId(null)}
          onOpenAgent={onOpenAgent}
          onOpenWorkspace={onOpenWorkspace}
          {...(subject.kind === 'agent' &&
          projectMapAgentForkable(subject.agent) &&
          !forkUnsupportedHosts.has(subject.agent.chat?.executionHostId ?? '')
            ? { onFork: () => setForkFor(selected) }
            : {})}
          {...(subject.kind === 'agent' && collapsed.collapsible.has(subject.agent.card.paneKey)
            ? {
                collapse: {
                  folded: collapsed.groups.has(
                    `${PROJECT_MAP_GROUP_PREFIX}${subject.agent.card.paneKey}`
                  ),
                  onToggle: () => onToggleCollapse(subject.agent.card.paneKey)
                }
              }
            : {})}
        />
      ) : null}
      <ProjectMapLegend />
    </div>
  )
}
