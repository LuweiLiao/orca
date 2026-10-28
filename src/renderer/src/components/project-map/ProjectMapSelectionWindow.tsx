import type { ProjectMapCollapsedView, ProjectMapGroup } from './project-map-collapse'
import { PROJECT_MAP_GROUP_PREFIX } from './project-map-collapse'
import type { ProjectMapAgent, ProjectMapGraph, ProjectMapWorkspace } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import type { ProjectMapRect } from './project-map-window-placement'
import { projectMapAgentForkable } from './project-map-window-subject'
import { ProjectMapChatWindow, type ProjectMapWindowSubject } from './ProjectMapChatWindow'
import type { ProjectMapForkIntent } from './ProjectMapForkWindow'
import { ProjectMapGroupTray } from './ProjectMapGroupTray'

type Props = {
  graph: ProjectMapGraph
  collapsed: ProjectMapCollapsedView
  selected: string | null
  /** The chat or workspace window to show; ignored when a stack is open. */
  subject: ProjectMapWindowSubject | null
  group: ProjectMapGroup | undefined
  anchor: ProjectMapRect
  viewport: { width: number; height: number }
  avoid: ProjectMapRect[]
  forkUnsupportedHosts: ReadonlySet<string>
  onSelect: (id: string | null) => void
  onOpenAgent: (agent: ProjectMapAgent) => void
  onOpenWorkspace: (workspace: ProjectMapWorkspace) => void
  onToggleCollapse: (parentPaneKey: string) => void
  onFork: (intent: ProjectMapForkIntent | null) => void
}

/** The window beside the selected node: a stack's chats, or the chat or workspace itself. */
export function ProjectMapSelectionWindow({
  graph,
  collapsed,
  selected,
  subject,
  group,
  anchor,
  viewport,
  avoid,
  forkUnsupportedHosts,
  onSelect,
  onOpenAgent,
  onOpenWorkspace,
  onToggleCollapse,
  onFork
}: Props): React.JSX.Element | null {
  if (group) {
    return (
      <ProjectMapGroupTray
        key={group.id}
        group={group}
        parentTitle={projectMapAgentTitle(
          graph.agents.get(group.parentPaneKey)?.card ?? collapsed.graph.agents.get(group.id)!.card
        )}
        agents={graph.agents}
        anchor={anchor}
        viewport={viewport}
        avoid={avoid}
        onClose={() => onSelect(null)}
        onOpenMember={onSelect}
        onExpand={() => {
          onSelect(group.parentPaneKey)
          onToggleCollapse(group.parentPaneKey)
        }}
      />
    )
  }
  if (!subject) {
    return null
  }
  return (
    <ProjectMapChatWindow
      key={selected}
      subject={subject}
      anchor={anchor}
      viewport={viewport}
      avoid={avoid}
      onClose={() => onSelect(null)}
      onOpenAgent={onOpenAgent}
      onOpenWorkspace={onOpenWorkspace}
      onSelectNode={onSelect}
      {...(subject.kind === 'agent' &&
      projectMapAgentForkable(subject.agent) &&
      !forkUnsupportedHosts.has(subject.agent.chat?.executionHostId ?? '')
        ? {
            onFork: () => onFork(selected ? { paneKey: selected } : null),
            onForkAt: (at: NonNullable<ProjectMapForkIntent['at']>) =>
              selected && onFork({ paneKey: selected, at })
          }
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
  )
}
