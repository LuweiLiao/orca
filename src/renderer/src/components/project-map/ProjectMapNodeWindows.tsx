import type { ProjectMapCollapsedView } from './project-map-collapse'
import { PROJECT_MAP_GROUP_PREFIX } from './project-map-collapse'
import type { ProjectMapAgent, ProjectMapGraph, ProjectMapWorkspace } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import type { ProjectMapRect } from './project-map-window-placement'
import { projectMapLinkedNodes, projectMapWindowSubject } from './project-map-window-subject'
import { ProjectMapChatWindow } from './ProjectMapChatWindow'
import { useProjectMapForkable } from './project-map-native-fork'
import { ProjectMapGroupTray } from './ProjectMapGroupTray'
import type { ProjectMapOpenWindow, ProjectMapOpenWindows } from './use-project-map-open-windows'

type Props = {
  graph: ProjectMapGraph
  collapsed: ProjectMapCollapsedView
  windows: ProjectMapOpenWindows
  /** Where a node is drawn: itself, or the stack it is folded into; null once it left the map. */
  shownAs: (id: string) => string | null
  toViewport: (id: string) => ProjectMapRect | null
  viewport: { width: number; height: number }
  /** The window being forked from gives way to its fork panel. */
  forkFor: string | null
  onOpenAgent: (agent: ProjectMapAgent) => void
  onOpenWorkspace: (workspace: ProjectMapWorkspace) => void
  onToggleCollapse: (parentPaneKey: string) => void
  onFork: (paneKey: string) => void
}

/** Every open node window, each beside its node, stacked by the one last touched. */
export function ProjectMapNodeWindows(props: Props): React.JSX.Element {
  return (
    <div data-project-map-window-layer="" className="pointer-events-none absolute inset-0 z-20">
      {props.windows.windows.map((entry) =>
        entry.id === props.forkFor ? null : (
          <ProjectMapNodeWindow key={entry.id} entry={entry} {...props} />
        )
      )}
    </div>
  )
}

/** One node's window: a stack's chats, or the chat or workspace itself. */
function ProjectMapNodeWindow({
  entry,
  graph,
  collapsed,
  windows,
  shownAs,
  toViewport,
  viewport,
  onOpenAgent,
  onOpenWorkspace,
  onToggleCollapse,
  onFork
}: Props & { entry: ProjectMapOpenWindow }): React.JSX.Element | null {
  const { id } = entry
  // Hidden where the host or agent cannot fork natively; nothing to refuse then.
  const forkable = useProjectMapForkable(graph.agents.get(id))
  const shown = shownAs(id)
  const anchor = shown ? toViewport(shown) : null
  if (!shown || !anchor) {
    return null
  }
  const avoid = [
    ...entry.avoid,
    ...[...projectMapLinkedNodes(collapsed.graph.edges, shown)].flatMap(
      (node) => toViewport(node) ?? []
    )
  ]
  const layer = { zIndex: entry.z, onRaise: () => windows.raise(id) }
  const group = shown === id ? collapsed.groups.get(id) : undefined
  if (group) {
    return (
      <ProjectMapGroupTray
        group={group}
        parentTitle={projectMapAgentTitle(
          graph.agents.get(group.parentPaneKey)?.card ?? collapsed.graph.agents.get(group.id)!.card
        )}
        agents={graph.agents}
        anchor={anchor}
        viewport={viewport}
        avoid={avoid}
        layer={layer}
        onClose={() => windows.close(id)}
        onOpenMember={windows.open}
        onExpand={() => {
          windows.close(id)
          windows.open(group.parentPaneKey)
          onToggleCollapse(group.parentPaneKey)
        }}
      />
    )
  }
  const subject = projectMapWindowSubject(graph, id)
  if (!subject) {
    return null
  }
  const fork = (): void => {
    windows.select(id)
    onFork(id)
  }
  return (
    <ProjectMapChatWindow
      subject={subject}
      anchor={anchor}
      viewport={viewport}
      avoid={avoid}
      layer={layer}
      onClose={() => windows.close(id)}
      onOpenAgent={onOpenAgent}
      onOpenWorkspace={onOpenWorkspace}
      {...(subject.kind === 'agent' && forkable ? { onFork: fork } : {})}
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
  )
}
