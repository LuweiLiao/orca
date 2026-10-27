import type { OrchestrationChatSession } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { DashboardCard } from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { isStructuredTab } from '../../../../shared/agent-session/view/structured-agent-session-tab'
import type { Tab } from '../../../../shared/workspace-layout/tab-groups/tab-types'
import type { AgentSessionConversationNames } from '../../../../shared/agent-session/conversation-naming/agent-session-conversation-names'
import type { AgentSessionStatusSnapshot } from '../../../../shared/agent-session/view/agent-session-status-snapshot-fold'

/** A structured chat behind a map card: its session and the host that runs it. */
export type ProjectMapChat = {
  sessionId: string
  agent: string
  executionHostId: ExecutionHostId | null
}

/** Child session id to the session it was forked from, as each host's chat feed names it. */
export type ProjectMapLineage = ReadonlyMap<string, string>

/** A chat a host still records at the end of a fork, open or not. */
export type ProjectMapHistoryChat = ProjectMapChat & {
  workspaceId: string
  title: string | null
}

/**
 * Which structured chat each card shows. A chat with an open tab is read from the tab; an
 * orchestrated chat whose tab was retired is read from the session the runtime published.
 */
export function projectMapChatsByPaneKey(
  cards: readonly DashboardCard[],
  tabsByWorktree: Readonly<Record<string, readonly Tab[] | undefined>>,
  sessionsByPaneKey: ReadonlyMap<string, OrchestrationChatSession>
): Map<string, ProjectMapChat> {
  const chats = new Map<string, ProjectMapChat>()
  for (const card of cards) {
    const tab = tabsByWorktree[card.worktreeId]?.find((candidate) => candidate.id === card.tabId)
    if (tab && isStructuredTab(tab) && tab.entityId && tab.agentSessionAgent) {
      chats.set(card.paneKey, {
        sessionId: tab.entityId,
        agent: tab.agentSessionAgent,
        executionHostId: tab.executionHostId ?? card.executionHostId ?? null
      })
      continue
    }
    const session = sessionsByPaneKey.get(card.paneKey)
    if (session) {
      chats.set(card.paneKey, {
        sessionId: session.sessionId,
        agent: session.provider,
        executionHostId: session.executionHostId
      })
    }
  }
  return chats
}

/** One host's naming and status feeds, as read for the map. */
export type ProjectMapHostFeed = {
  executionHostId: ExecutionHostId | null
  names: AgentSessionConversationNames
  statuses: AgentSessionStatusSnapshot
}

/**
 * Fork sources of the open chats, followed up through chats that are no longer open, and each
 * such closed chat a host still records, so a fork through it keeps its place on the map.
 */
export function projectMapLineageFromFeeds(
  openSessionIds: Iterable<string>,
  hosts: readonly ProjectMapHostFeed[]
): { lineage: Map<string, string>; history: Map<string, ProjectMapHistoryChat> } {
  const open = new Set(openSessionIds)
  const lineage = new Map<string, string>()
  const history = new Map<string, ProjectMapHistoryChat>()
  const pending = [...open]
  const seen = new Set(pending)
  while (pending.length > 0) {
    const sessionId = pending.shift()!
    for (const host of hosts) {
      const name = host.names.get(sessionId)
      const status = host.statuses.get(sessionId)
      if (!name && !status) {
        continue
      }
      if (!open.has(sessionId) && status) {
        history.set(sessionId, {
          sessionId,
          agent: status.agent,
          executionHostId: host.executionHostId,
          workspaceId: status.workspaceId,
          title: name?.conversationName?.trim() || null
        })
      }
      const source = name?.forkedFrom?.sessionId
      if (source) {
        lineage.set(sessionId, source)
        if (!seen.has(source)) {
          seen.add(source)
          pending.push(source)
        }
      }
      break
    }
  }
  return { lineage, history }
}
