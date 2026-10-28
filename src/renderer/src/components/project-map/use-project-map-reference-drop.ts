import { useCallback } from 'react'
import type { ConversationReferenceCreate } from '../../../../shared/conversation-reference'
import type { ProjectMapGraph } from './project-map-graph'
import { insertReferenceInMapWindow } from './project-map-reference-drop'

const PROJECT_MAP_CHAT_WINDOW = '[data-project-map-chat-window]'

/** Opens the chat a reference was dropped on and puts the reference in its message box. */
export function useProjectMapReferenceDrop(
  graph: ProjectMapGraph,
  onTarget: (paneKey: string) => void
): (target: string, source: ConversationReferenceCreate) => void {
  return useCallback(
    (target, source) => {
      const chat = graph.agents.get(target)?.chat
      if (source.source.kind === 'structured' && source.source.sessionId === chat?.sessionId) {
        return
      }
      onTarget(target)
      void insertReferenceInMapWindow(PROJECT_MAP_CHAT_WINDOW, source)
    },
    [graph.agents, onTarget]
  )
}
