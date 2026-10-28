// Chats whose tabs are closed but that a fork still connects to the map, or that were closed from it.

import type { DashboardCard } from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import { structuredAgentSessionTabId } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import type { ProjectMapForkInput, ProjectMapWorkspace } from './project-map-graph'
import type { ProjectMapHistoryChat } from './project-map-lineage'

/** Fork ends with no open card, sources before the children forked from them. */
export function closedForkEnds(
  forks: ProjectMapForkInput,
  open: ReadonlyMap<string, string>
): ProjectMapHistoryChat[] {
  const order: string[] = []
  const placed = new Set<string>()
  const place = (sessionId: string, trail: Set<string>): void => {
    if (placed.has(sessionId) || trail.has(sessionId)) {
      return
    }
    trail.add(sessionId)
    const source = forks.lineage.get(sessionId)
    if (source) {
      place(source, trail)
    }
    placed.add(sessionId)
    order.push(sessionId)
  }
  for (const [child, source] of forks.lineage) {
    place(source, new Set())
    place(child, new Set())
  }
  return order.flatMap((sessionId) => {
    const chat = open.has(sessionId) ? undefined : forks.history?.get(sessionId)
    return chat ? [chat] : []
  })
}

export const PROJECT_MAP_HISTORY_PANE_PREFIX = 'project-map-history:'

export function projectMapHistoryCard(
  chat: ProjectMapHistoryChat,
  workspace: ProjectMapWorkspace
): DashboardCard {
  return {
    paneKey: `${PROJECT_MAP_HISTORY_PANE_PREFIX}${chat.sessionId}`,
    ptyId: null,
    agentType: chat.agent,
    bucket: 'idle',
    dotState: 'idle',
    task: chat.title ?? '',
    ...(chat.title ? { conversationName: chat.title } : {}),
    repoId: workspace.repoId,
    worktreeId: workspace.worktreeId,
    tabId: structuredAgentSessionTabId(chat.sessionId),
    leafId: null,
    repoName: workspace.repoName,
    worktreeName: workspace.worktreeName,
    hostKind: workspace.hostKind,
    ...(chat.executionHostId ? { executionHostId: chat.executionHostId } : {}),
    workspaceKind: workspace.workspaceKind,
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false
  }
}

/** Fork ends and the chats closed from this map, as history nodes; a chat is listed once. */
export function closedChatsForGraph(
  forks: ProjectMapForkInput,
  open: ReadonlyMap<string, string>
): ProjectMapHistoryChat[] {
  const ends = closedForkEnds(forks, open)
  const listed = new Set(ends.map((chat) => chat.sessionId))
  const closedByMap = (forks.closedByMap ?? []).flatMap((chat) =>
    open.has(chat.sessionId) || listed.has(chat.sessionId)
      ? []
      : [
          {
            sessionId: chat.sessionId,
            agent: chat.agent,
            executionHostId: chat.executionHostId,
            workspaceId: chat.workspaceId,
            title: chat.title
          }
        ]
  )
  return [...ends, ...closedByMap]
}
