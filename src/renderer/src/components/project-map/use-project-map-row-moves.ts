import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { translate } from '@/i18n/i18n'
import { pushProjectMapUndo, pushProjectMapUndoWithToast } from './use-project-map-undo'
import type { ProjectMapGraph } from './project-map-graph'
import type { ProjectMapLayout } from './project-map-layout'
import {
  applyProjectMapChatRows,
  projectMapChatRows,
  subscribeToProjectMapChatRows,
  type ProjectMapRowChanges
} from './project-map-chat-rows'
import {
  projectMapRowMove,
  projectMapTidyRows,
  type ProjectMapRowDirection
} from './project-map-row-moves'

export type ProjectMapRowMoves = {
  can: (paneKey: string, direction: ProjectMapRowDirection) => boolean
  /** Moves a chat one row; returns the changes that undo it, or null if it could not move. */
  move: (paneKey: string, direction: ProjectMapRowDirection) => ProjectMapRowChanges | null
  /** Whether any chat of this project has a hand-set row. */
  canTidy: boolean
  /** Clears this project's hand-set rows; returns the changes that undo it. */
  tidy: () => ProjectMapRowChanges
  /** Puts rows back as an earlier `move` or `tidy` returned them. */
  restore: (before: ProjectMapRowChanges) => void
}

/** Moving chats between rows of their lane, kept on this desktop. */
export function useProjectMapRowMoves(
  graph: ProjectMapGraph,
  layout: ProjectMapLayout
): ProjectMapRowMoves {
  const pins = useSyncExternalStore(subscribeToProjectMapChatRows, projectMapChatRows)
  const move = useCallback(
    (paneKey: string, direction: ProjectMapRowDirection) => {
      const changes = projectMapRowMove(graph, layout, paneKey, direction)
      const before = changes ? applyProjectMapChatRows(changes) : null
      if (before) {
        const label =
          direction === 'up'
            ? translate('projectMap.menu.moveUp', 'Move up')
            : translate('projectMap.menu.moveDown', 'Move down')
        pushProjectMapUndo({ label, undo: () => void applyProjectMapChatRows(before) })
      }
      return before
    },
    [graph, layout]
  )
  const can = useCallback(
    (paneKey: string, direction: ProjectMapRowDirection) =>
      projectMapRowMove(graph, layout, paneKey, direction) !== null,
    [graph, layout]
  )
  const tidyChanges = useMemo(() => projectMapTidyRows(graph, pins), [graph, pins])
  const tidy = useCallback(() => {
    const before = applyProjectMapChatRows(projectMapTidyRows(graph, projectMapChatRows()))
    const label = translate('projectMap.menu.tidy', 'Tidy layout')
    pushProjectMapUndoWithToast({ label, undo: () => void applyProjectMapChatRows(before) }, label)
    return before
  }, [graph])
  return { can, move, canTidy: tidyChanges.size > 0, tidy, restore: applyProjectMapChatRows }
}
