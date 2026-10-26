import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import type { ProjectMapAgent, ProjectMapGraph, ProjectMapWorkspace } from './project-map-graph'
import { PROJECT_MAP_NODE, type ProjectMapLayout } from './project-map-layout'
import type { useProjectMapViewport } from './use-project-map-viewport'
import { ProjectMapAgentNode, ProjectMapWorkspaceNode } from './ProjectMapNode'
import { ProjectMapChatWindow, type ProjectMapWindowSubject } from './ProjectMapChatWindow'
import { ProjectMapForkPanel } from './ProjectMapForkPanel'
import type { ProjectMapRect } from './project-map-window-placement'

type Props = {
  graph: ProjectMapGraph
  layout: ProjectMapLayout
  viewport: ReturnType<typeof useProjectMapViewport>
  activeWorktreeId: string | null
  onOpenAgent: (agent: ProjectMapAgent) => void
  onOpenWorkspace: (workspace: ProjectMapWorkspace) => void
  /** A fork made a chat; its lineage is worth reading again. */
  onForked: () => void
}

/** A chat this renderer can fork: structured, on a host the map can reach by runtime RPC. */
export function projectMapAgentForkable(agent: ProjectMapAgent | undefined): boolean {
  return Boolean(
    agent?.chat?.executionHostId && agent.card.hostKind !== 'ssh' && agent.card.hostKind !== 'wsl'
  )
}

const EMPTY_WORKTREES: readonly { id: string; branch: string }[] = []

type CssVariables = React.CSSProperties & Record<`--${string}`, string | number>

function windowSubject(graph: ProjectMapGraph, id: string | null): ProjectMapWindowSubject | null {
  const agent = id ? graph.agents.get(id) : undefined
  if (agent) {
    return { kind: 'agent', agent }
  }
  const workspace = id ? graph.workspaces.get(id) : undefined
  return workspace
    ? {
        kind: 'workspace',
        workspace,
        agents: workspace.agentPaneKeys.flatMap((paneKey) => graph.agents.get(paneKey) ?? [])
      }
    : null
}

export function ProjectMapCanvas({
  graph,
  layout,
  viewport,
  activeWorktreeId,
  onOpenAgent,
  onOpenWorkspace,
  onForked
}: Props): React.JSX.Element {
  const { view } = viewport
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [forkFor, setForkFor] = useState<string | null>(null)
  // A new child shows up on a later snapshot; select it then, by its chat's session.
  const [awaitedSession, setAwaitedSession] = useState<string | null>(null)
  const worktrees = useAppStore((s) => selectWorktreesByRepo(s)[graph.projectId] ?? EMPTY_WORKTREES)
  const branchById = useMemo(
    () =>
      new Map(
        worktrees.map((worktree) => [worktree.id, worktree.branch.replace(/^refs\/heads\//, '')])
      ),
    [worktrees]
  )
  // A node that vanished (agent closed, project switched) takes its window with it.
  const selected = selectedId && layout.nodes.has(selectedId) ? selectedId : null
  const forkOrigin = forkFor === selected && selected ? graph.agents.get(selected) : undefined

  // Adjusted during render, not in an effect, so the new node never draws unselected first.
  const arrived = awaitedSession
    ? [...graph.agents.values()].find((agent) => agent.chat?.sessionId === awaitedSession)
    : undefined
  if (arrived && layout.nodes.has(arrived.card.paneKey)) {
    setSelectedId(arrived.card.paneKey)
    setAwaitedSession(null)
  }

  const linked = useMemo(() => {
    const ids = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.from === selected) {
        ids.add(edge.to)
      } else if (edge.to === selected) {
        ids.add(edge.from)
      }
    }
    return ids
  }, [graph.edges, selected])

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
  const subject = windowSubject(graph, selected)
  // The grid background pans and scales with the content.
  const viewportStyle: CssVariables = {
    '--pm-zoom': view.zoom,
    '--pm-pan-x': `${view.x}px`,
    '--pm-pan-y': `${view.y}px`
  }
  const anchor = selected ? toViewport(selected) : null

  return (
    <div
      ref={viewport.viewportRef}
      data-focusing={selected !== null}
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
          {layout.wires.map((wire) => (
            <path
              key={`${wire.kind}:${wire.from}:${wire.to}`}
              className="project-map-wire"
              data-kind={wire.kind}
              data-highlighted={wire.from === selected || wire.to === selected}
              d={wire.path}
            />
          ))}
        </svg>
        {[...layout.nodes.values()].map((box) => {
          const workspace = graph.workspaces.get(box.id)
          const agent = graph.agents.get(box.id)
          const common = {
            box,
            selected: box.id === selected,
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
          ) : agent ? (
            <ProjectMapAgentNode
              key={box.id}
              {...common}
              agent={agent}
              graphAgents={graph.agents}
            />
          ) : null
        })}
        {selected && projectMapAgentForkable(graph.agents.get(selected)) ? (
          <ForkHandle
            box={layout.nodes.get(selected)!}
            open={forkOrigin !== undefined}
            onOpen={() => setForkFor(selected)}
          />
        ) : null}
      </div>
      {forkOrigin && anchor ? (
        <ProjectMapForkPanel
          key={`fork:${selected}`}
          origin={forkOrigin}
          agents={graph.agents}
          anchor={anchor}
          viewport={viewport.size}
          avoid={[...linked].flatMap((id) => toViewport(id) ?? [])}
          onClose={() => setForkFor(null)}
          onCreated={({ sessionId }) => {
            setForkFor(null)
            setAwaitedSession(sessionId)
            onForked()
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
          {...(subject.kind === 'agent' && projectMapAgentForkable(subject.agent)
            ? { onFork: () => setForkFor(selected) }
            : {})}
        />
      ) : null}
      <ProjectMapLegend />
    </div>
  )
}

const WORKSPACE_SWATCH: CssVariables = { '--pm-kind': 'var(--pm-kind-workspace)' }
const AGENT_SWATCH: CssVariables = { '--pm-kind': 'var(--pm-kind-agent)' }

function ProjectMapLegend(): React.JSX.Element {
  const item = 'inline-flex items-center gap-1.5 whitespace-nowrap'
  return (
    <div
      aria-label={translate('projectMap.legendLabel', 'Legend')}
      onPointerDown={(event) => event.stopPropagation()}
      className="absolute bottom-3 left-3 z-10 flex h-8 items-center gap-3.5 rounded-md border border-border bg-card px-3 text-[11px] text-muted-foreground shadow-xs"
    >
      <span className={item}>
        <span
          className="project-map-legend-swatch size-3 rounded-[3px] border border-border"
          style={WORKSPACE_SWATCH}
        />
        {translate('projectMap.legend.workspace', 'Workspace')}
      </span>
      <span className={item}>
        <span
          className="project-map-legend-swatch size-3 rounded-[3px] border border-border"
          style={AGENT_SWATCH}
        />
        {translate('projectMap.legend.conversation', 'Conversation')}
      </span>
      <span className={item}>
        <span className="project-map-pin" data-legend data-wire="derive" />
        {translate('projectMap.legend.derive', 'Derived')}
      </span>
      <span className={item}>
        <span className="project-map-pin" data-legend data-wire="delegate" />
        {translate('projectMap.legend.delegate', 'Delegated')}
      </span>
      <span className={item}>
        <span className="project-map-fork-pin" data-legend data-wire="fork" />
        {translate('projectMap.legend.fork', 'Forked')}
      </span>
      <span className={item}>
        <span className="project-map-fork-pin" data-legend data-wire="handoff" />
        {translate('projectMap.legend.handoff', 'Handed off')}
      </span>
      <span className={item}>
        <span className="project-map-pin" data-legend data-wire="unresolved" />
        {translate('projectMap.legend.unresolved', 'Source not loaded')}
      </span>
    </div>
  )
}

/** Sits on the selected node's fork pin, inside the scaled content so it pans with the node. */
function ForkHandle({
  box,
  open,
  onOpen
}: {
  box: { x: number; y: number; width: number }
  open: boolean
  onOpen: () => void
}): React.JSX.Element {
  const label = translate('projectMap.fork.title', 'New child chat')
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      title={label}
      data-project-map-fork-handle=""
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
      className="project-map-fork-handle absolute z-10 grid size-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground"
      style={{ left: box.x + box.width + 4, top: box.y + PROJECT_MAP_NODE.headerPinOffsetY }}
    >
      <Plus aria-hidden className="size-3.5" />
    </button>
  )
}
