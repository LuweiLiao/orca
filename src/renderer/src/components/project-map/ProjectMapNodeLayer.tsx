import WorktreeContextMenu from '@/components/sidebar/workspace-actions/context-menu/WorktreeContextMenu'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ProjectMapCollapsedView } from './project-map-collapse'
import type { ProjectMapGraph } from './project-map-graph'
import type { ProjectMapLayout } from './project-map-layout'
import { ProjectMapAgentNode, ProjectMapGroupNode, ProjectMapWorkspaceNode } from './ProjectMapNode'

type Props = {
  graph: ProjectMapGraph
  collapsed: ProjectMapCollapsedView
  layout: ProjectMapLayout
  selectedShown: string | null
  linked: ReadonlySet<string>
  activeWorktreeId: string | null
  worktreeById: ReadonlyMap<string, Worktree>
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

/** Every node the layout placed; a workspace node carries the sidebar's workspace menu. */
export function ProjectMapNodeLayer({
  graph,
  collapsed,
  layout,
  selectedShown,
  linked,
  activeWorktreeId,
  worktreeById,
  onSelect,
  onHover
}: Props): React.JSX.Element {
  return (
    <>
      {[...layout.nodes.values()].map((box) => {
        const workspace = graph.workspaces.get(box.id)
        const agent = collapsed.graph.agents.get(box.id)
        const stack = collapsed.groups.get(box.id)
        const common = {
          box,
          selected: box.id === selectedShown,
          linked: linked.has(box.id),
          onSelect
        }
        if (workspace) {
          const worktree = worktreeById.get(box.id)
          const node = (
            <ProjectMapWorkspaceNode
              key={box.id}
              {...common}
              workspace={workspace}
              branch={worktree?.branch.replace(/^refs\/heads\//, '') ?? null}
              current={box.id === activeWorktreeId}
            />
          )
          return worktree ? (
            <WorktreeContextMenu key={box.id} worktree={worktree}>
              {node}
            </WorktreeContextMenu>
          ) : (
            node
          )
        }
        return stack ? (
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
            onHover={onHover}
            graphAgents={graph.agents}
          />
        ) : null
      })}
    </>
  )
}
