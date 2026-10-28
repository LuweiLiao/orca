// Chats whose tabs are closed but that a fork or reference still connects to the map.

import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { agentSessionLineageSources } from '../../../../shared/agent-session-fork'
import { structuredAgentSessionTabId } from '../../../../shared/structured-agent-session-projection'
import type { ProjectMapForkInput, ProjectMapWorkspace } from './project-map-graph'
import type { ProjectMapHistoryChat } from './project-map-lineage'

/** Fork and reference ends with no open card, sources before what came from them. */
export function closedForkEnds(
  forks: ProjectMapForkInput,
  open: ReadonlyMap<string, string>
): ProjectMapHistoryChat[] {
  const order = [
    ...[...forks.lineage.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .flatMap((entry) => [
        ...agentSessionLineageSources(entry).map((source) => source.sessionId),
        entry.childSessionId
      ]),
    ...(forks.references ?? []).flatMap((link) =>
      link.source ? [link.source.sessionId, link.targetSessionId] : [link.targetSessionId]
    )
  ]
  return [...new Set(order)].flatMap((sessionId) => {
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
