import type {
  AgentStatusOrchestrationContext,
  OrchestrationChatSession
} from '../../shared/agent-status-types'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { buildOrchestrationTaskDisplayMetadata } from '../../shared/orchestration-task-display'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../shared/structured-agent-session-projection'
import type { OrchestrationDb } from './orchestration/db'
import {
  resolveLineageRunningSession,
  type AgentSessionRecordReader
} from './orchestration/structured-session-lineage'

function chatSession(record: AgentSessionRecord): OrchestrationChatSession {
  return {
    sessionId: record.sessionId,
    worktreeId: record.location.workspaceId,
    executionHostId: record.location.executionHostId,
    provider: record.provider,
    conversationName: record.conversationName,
    model: record.options?.model,
    effort: record.options?.effort,
    createdAt: record.createdAt
  }
}

function chatPaneKey(session: OrchestrationChatSession): string {
  return structuredAgentSessionPaneKey(
    structuredAgentSessionTabId(session.sessionId),
    session.sessionId
  )
}

export function buildOrchestrationChatContexts(
  db: OrchestrationDb,
  store: AgentSessionRecordReader | null
): Record<string, AgentStatusOrchestrationContext> {
  const records = store?.listRecords() ?? []
  if (records.length === 0) {
    return {}
  }
  const recordsById = new Map(records.map((record) => [record.sessionId, record]))
  const reader: AgentSessionRecordReader = {
    listRecords: () => records,
    getRecord: (id) => recordsById.get(id) ?? null
  }
  const sessions = new Map<string, OrchestrationChatSession | undefined>()
  const resolveSession = (id: string | null): OrchestrationChatSession | undefined => {
    if (!id) {
      return undefined
    }
    if (!sessions.has(id)) {
      const resolved = resolveLineageRunningSession(reader, id)
      sessions.set(id, resolved.kind === 'unverifiable' ? undefined : chatSession(resolved.record))
    }
    return sessions.get(id)
  }
  const contexts: Record<string, AgentStatusOrchestrationContext> = {}
  for (const dispatch of db.getLatestDispatchesForStructuredSessions([...recordsById.keys()])) {
    const session = resolveSession(dispatch.assignee_orca_session_id)
    if (!session) {
      continue
    }
    const run = db.getRun(dispatch.run_id)
    const task = db.getTask(dispatch.task_id, dispatch.run_id)
    // A run can change coordinators; the recorded creator remains the conversation's parent.
    const parentSession = resolveSession(
      dispatch.creator_orca_session_id ?? run?.coordinator_orca_session_id ?? null
    )
    const parentPaneKey = parentSession
      ? chatPaneKey(parentSession)
      : (dispatch.creator_pane_key ?? run?.coordinator_pane_key ?? undefined)
    const display = task
      ? buildOrchestrationTaskDisplayMetadata({
          spec: task.spec,
          taskTitle: task.task_title,
          displayName: task.display_name
        })
      : undefined
    contexts[chatPaneKey(session)] = {
      taskId: dispatch.task_id,
      dispatchId: dispatch.id,
      dispatchStatus: dispatch.status,
      orchestrationRunId: dispatch.run_id,
      taskTitle: display?.taskTitle,
      displayName: display?.displayName,
      parentPaneKey,
      session,
      parentSession
    }
  }
  return contexts
}
