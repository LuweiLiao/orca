import { useAppStore } from '@/store'
import { findRenamableUnifiedTab } from '@/store/terminals/renamable-unified-tab'
import { noteProjectMapClosedChat } from '@/lib/project-map-closed-by-map'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import { projectMapCloseUndoable } from './project-map-node-actions'
import { reopenProjectMapChat } from './project-map-reopen'

export type ProjectMapClosed = {
  /** Reopens the chat from its record; absent for a terminal, whose process cannot come back. */
  reopen?: () => Promise<void>
}

/** Closes a chat's tab and remembers it as a grey node; null when it has no tab to close. */
export function closeProjectMapAgent(agent: ProjectMapAgent): ProjectMapClosed | null {
  const state = useAppStore.getState()
  const tab = findRenamableUnifiedTab(state.unifiedTabsByWorktree, agent.card.tabId)
  if (!tab) {
    return null
  }
  const { chat } = agent
  if (chat) {
    noteProjectMapClosedChat({
      sessionId: chat.sessionId,
      workspaceId: agent.card.worktreeId,
      executionHostId: chat.executionHostId,
      agent: chat.agent,
      title: projectMapAgentTitle(agent.card)
    })
  }
  state.closeUnifiedTab(tab.id)
  return chat && projectMapCloseUndoable(agent)
    ? {
        reopen: async () => {
          if (!(await reopenProjectMapChat(agent))) {
            throw new Error('reopen failed')
          }
        }
      }
    : {}
}
