import { useAppStore } from '@/store'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import { PROJECT_MAP_NODE, type ProjectMapLayout } from './project-map-layout'
import { findRenamableUnifiedTab } from '@/store/terminals/renamable-unified-tab'
import { pushProjectMapUndo } from './use-project-map-undo'
import { ProjectMapRenameInput } from './ProjectMapRenameInput'

type Props = {
  layout: ProjectMapLayout
  agents: ReadonlyMap<string, ProjectMapAgent>
  /** The chat whose name is being edited over its node. */
  renamingId: string | null
  onRenameEnd: () => void
  /** The node a search just found, flagged for a moment; `flash` restarts the animation. */
  match: { id: string; flash: number } | null
  /** The node the keyboard is on, ringed while the map has focus. */
  cursorId: string | null
}

/** What sits over nodes inside the canvas without being part of them: a name field, a flash. */
export function ProjectMapNodeOverlays({
  layout,
  agents,
  renamingId,
  onRenameEnd,
  match,
  cursorId
}: Props): React.JSX.Element {
  const renaming = renamingId ? agents.get(renamingId) : undefined
  const renamingBox = renaming ? layout.nodes.get(renaming.card.paneKey) : undefined
  const cursorBox = cursorId ? layout.nodes.get(cursorId) : undefined
  const matchBox = match ? layout.nodes.get(match.id) : undefined
  return (
    <>
      {renaming && renamingBox ? (
        <ProjectMapRenameInput
          key={renaming.card.paneKey}
          box={renamingBox}
          title={projectMapAgentTitle(renaming.card)}
          onCommit={(title) => {
            const store = useAppStore.getState()
            const tabId = renaming.card.tabId
            const before = findRenamableUnifiedTab(store.unifiedTabsByWorktree, tabId)?.customLabel
            store.setTabCustomTitle(tabId, title)
            pushProjectMapUndo({
              label: projectMapAgentTitle(renaming.card),
              undo: () => useAppStore.getState().setTabCustomTitle(tabId, before ?? null)
            })
            onRenameEnd()
          }}
          onCancel={onRenameEnd}
        />
      ) : null}
      {cursorBox ? (
        <div
          aria-hidden
          data-project-map-cursor={cursorId}
          className="project-map-cursor pointer-events-none absolute"
          style={{
            left: cursorBox.x,
            top: cursorBox.y,
            width: cursorBox.width,
            height: PROJECT_MAP_NODE.height
          }}
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
