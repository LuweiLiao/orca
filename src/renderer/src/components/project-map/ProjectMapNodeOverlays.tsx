import { useAppStore } from '@/store'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import { PROJECT_MAP_NODE, type ProjectMapLayout } from './project-map-layout'
import { ProjectMapRenameInput } from './ProjectMapRenameInput'

type Props = {
  layout: ProjectMapLayout
  agents: ReadonlyMap<string, ProjectMapAgent>
  /** The chat whose name is being edited over its node. */
  renamingId: string | null
  onRenameEnd: () => void
  /** The node a search just found, flagged for a moment; `flash` restarts the animation. */
  match: { id: string; flash: number } | null
}

/** What sits over nodes inside the canvas without being part of them: a name field, a flash. */
export function ProjectMapNodeOverlays({
  layout,
  agents,
  renamingId,
  onRenameEnd,
  match
}: Props): React.JSX.Element {
  const renaming = renamingId ? agents.get(renamingId) : undefined
  const renamingBox = renaming ? layout.nodes.get(renaming.card.paneKey) : undefined
  const matchBox = match ? layout.nodes.get(match.id) : undefined
  return (
    <>
      {renaming && renamingBox ? (
        <ProjectMapRenameInput
          key={renaming.card.paneKey}
          box={renamingBox}
          title={projectMapAgentTitle(renaming.card)}
          onCommit={(title) => {
            useAppStore.getState().setTabCustomTitle(renaming.card.tabId, title)
            onRenameEnd()
          }}
          onCancel={onRenameEnd}
        />
      ) : null}
      {match && matchBox ? (
        <div
          key={match.flash}
          aria-hidden
          data-project-map-match={match.id}
          className="project-map-match pointer-events-none absolute"
          style={{
            left: matchBox.x,
            top: matchBox.y,
            width: matchBox.width,
            height: PROJECT_MAP_NODE.height
          }}
        />
      ) : null}
    </>
  )
}
