import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import type {
  AgentStatusOrchestrationContext,
  OrchestrationChatSession
} from '../../../../shared/agent-status-types'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { isStructuredTab } from '../../../../shared/structured-agent-session-tab'
import type { Tab } from '../../../../shared/tab-types'

/** A structured chat behind a map card: its session and the host that runs it. */
export type ProjectMapChat = {
  sessionId: string
  agent: string
  executionHostId: ExecutionHostId | null
}

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

/** One host's forks, merged across hosts by child session; a child is created on exactly one. */
export function mergeProjectMapLineage(
  pages: readonly (readonly AgentSessionLineageEntry[])[]
): Map<string, AgentSessionLineageEntry> {
  const merged = new Map<string, AgentSessionLineageEntry>()
  for (const entries of pages) {
    for (const entry of entries) {
      merged.set(entry.childSessionId, entry)
    }
  }
  return merged
}

/** The structured chat behind each orchestrated pane, read from the sessions the runtime published. */
export function projectMapChatSessions(
  contexts: Readonly<Record<string, AgentStatusOrchestrationContext>> | undefined
): Map<string, OrchestrationChatSession> {
  const sessions = new Map<string, OrchestrationChatSession>()
  for (const [paneKey, context] of Object.entries(contexts ?? {})) {
    if (context.session) {
      sessions.set(paneKey, context.session)
    }
  }
  for (const context of Object.values(contexts ?? {})) {
    if (context.parentPaneKey && context.parentSession && !sessions.has(context.parentPaneKey)) {
      sessions.set(context.parentPaneKey, context.parentSession)
    }
  }
  return sessions
}
