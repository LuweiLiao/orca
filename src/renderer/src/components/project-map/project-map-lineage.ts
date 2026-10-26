import type { OrchestrationChatSession } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { DashboardCard } from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { isStructuredTab } from '../../../../shared/agent-session/view/structured-agent-session-tab'
import type { Tab } from '../../../../shared/workspace-layout/tab-groups/tab-types'
import type { AgentSessionConversationNames } from '../../../../shared/agent-session/conversation-naming/agent-session-conversation-names'

/** A structured chat behind a map card: its session and the host that runs it. */
export type ProjectMapChat = {
  sessionId: string
  agent: string
  executionHostId: ExecutionHostId | null
}

/** Child session id to the session it was forked from, as each host's chat feed names it. */
export type ProjectMapLineage = ReadonlyMap<string, string>

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

/** The fork sources of the given chats, read from their hosts' naming feeds. */
export function projectMapLineageFromNames(
  sessionIds: Iterable<string>,
  names: readonly AgentSessionConversationNames[]
): Map<string, string> {
  const lineage = new Map<string, string>()
  for (const sessionId of sessionIds) {
    for (const host of names) {
      const source = host.get(sessionId)?.forkedFrom?.sessionId
      if (source) {
        lineage.set(sessionId, source)
        break
      }
    }
  }
  return lineage
}
