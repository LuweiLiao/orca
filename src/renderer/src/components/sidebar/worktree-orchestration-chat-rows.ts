import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext,
  OrchestrationChatSession
} from '../../../../shared/agent-status-types'
import { tabFromWorktreeAttributedStatusEntry } from './worktree-agent-row-fallback-tab'

export function appendOrchestrationChatRows(
  rows: DashboardAgentRow[],
  contexts: Record<string, AgentStatusOrchestrationContext> = {}
): void {
  const rowIndex = new Map(rows.map((row, index) => [row.paneKey, index]))
  const append = (
    paneKey: string,
    session: OrchestrationChatSession,
    orchestration?: AgentStatusOrchestrationContext
  ): void => {
    const index = rowIndex.get(paneKey)
    if (index !== undefined) {
      rows[index] = { ...rows[index]!, structuredSession: session, startedAt: session.createdAt }
      return
    }
    const entry: AgentStatusEntry = {
      paneKey,
      worktreeId: session.worktreeId,
      agentType: session.provider,
      model: session.model,
      prompt:
        session.conversationName || orchestration?.displayName || orchestration?.taskTitle || '',
      state: 'done',
      updatedAt: session.createdAt,
      stateStartedAt: session.createdAt,
      stateHistory: [],
      orchestration
    }
    const tab = tabFromWorktreeAttributedStatusEntry(entry, session.createdAt)
    if (!tab) {
      return
    }
    rowIndex.set(paneKey, rows.length)
    rows.push({
      paneKey,
      entry,
      tab,
      agentType: session.provider,
      structuredSession: session,
      state: orchestration?.dispatchStatus === 'completed' ? 'done' : 'idle',
      startedAt: session.createdAt
    })
  }
  // Insert workers first so a nested worker's own dispatch wins over its parent placeholder.
  for (const [paneKey, context] of Object.entries(contexts)) {
    if (context.session) {
      append(paneKey, context.session, context)
    }
  }
  for (const context of Object.values(contexts)) {
    if (context.parentSession && context.parentPaneKey) {
      append(context.parentPaneKey, context.parentSession)
    }
  }
}
