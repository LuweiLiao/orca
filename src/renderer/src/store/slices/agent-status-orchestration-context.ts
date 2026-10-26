import type {
  AgentStatusOrchestrationContext,
  OrchestrationChatSession
} from '../../../../shared/agent-status-types'
import { orchestrationFleetAttentionEqual } from '../../../../shared/orchestration-fleet-attention'

function chatSessionsEqual(
  a: OrchestrationChatSession | undefined,
  b: OrchestrationChatSession | undefined
): boolean {
  return (
    a === b ||
    Boolean(
      a &&
      b &&
      a.sessionId === b.sessionId &&
      a.worktreeId === b.worktreeId &&
      a.executionHostId === b.executionHostId &&
      a.provider === b.provider &&
      a.conversationName === b.conversationName &&
      a.model === b.model &&
      a.effort === b.effort &&
      a.createdAt === b.createdAt
    )
  )
}

export function orchestrationContextsEqual(
  a: AgentStatusOrchestrationContext,
  b: AgentStatusOrchestrationContext
): boolean {
  return (
    a.taskId === b.taskId &&
    a.dispatchId === b.dispatchId &&
    a.dispatchStatus === b.dispatchStatus &&
    a.taskTitle === b.taskTitle &&
    a.displayName === b.displayName &&
    a.parentTerminalHandle === b.parentTerminalHandle &&
    a.parentPaneKey === b.parentPaneKey &&
    a.coordinatorHandle === b.coordinatorHandle &&
    a.orchestrationRunId === b.orchestrationRunId &&
    chatSessionsEqual(a.session, b.session) &&
    chatSessionsEqual(a.parentSession, b.parentSession) &&
    orchestrationFleetAttentionEqual(a.attention, b.attention)
  )
}

export function orchestrationMapsEqual(
  a: Record<string, AgentStatusOrchestrationContext>,
  b: Record<string, AgentStatusOrchestrationContext>
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  return aKeys.every((key) => b[key] !== undefined && orchestrationContextsEqual(a[key]!, b[key]!))
}

export function mergeCurrentOrchestrationContext(
  existing: AgentStatusOrchestrationContext | undefined,
  current: AgentStatusOrchestrationContext
): AgentStatusOrchestrationContext {
  if (!existing) {
    return current
  }
  const sameDispatch =
    existing.taskId === current.taskId && existing.dispatchId === current.dispatchId
  if (!sameDispatch) {
    return current
  }
  if (current.dispatchStatus !== undefined) {
    return orchestrationContextsEqual(existing, current) ? existing : current
  }
  const merged = { ...existing, ...current }
  return orchestrationContextsEqual(existing, merged) ? existing : merged
}
