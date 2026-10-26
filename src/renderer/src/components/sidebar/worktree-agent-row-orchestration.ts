import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext
} from '../../../../shared/agent-status-types'
import { orchestrationContextsEqual } from '@/store/slices/agent-status-orchestration-context'

export function entryWithRuntimeOrchestration(
  entry: AgentStatusEntry,
  runtimeAgentOrchestrationByPaneKey: Record<string, AgentStatusOrchestrationContext> | undefined
): AgentStatusEntry {
  const runtimeOrchestration = runtimeAgentOrchestrationByPaneKey?.[entry.paneKey]
  const sameDispatch =
    entry.orchestration &&
    runtimeOrchestration &&
    entry.orchestration.taskId === runtimeOrchestration.taskId &&
    entry.orchestration.dispatchId === runtimeOrchestration.dispatchId
  if (entry.orchestration && runtimeOrchestration && !sameDispatch) {
    return entry
  }
  const orchestration =
    sameDispatch && entry.orchestration && runtimeOrchestration
      ? { ...entry.orchestration, ...runtimeOrchestration }
      : (runtimeOrchestration ?? entry.orchestration)
  if (!orchestration || orchestration === entry.orchestration) {
    return entry
  }
  if (entry.orchestration && orchestrationContextsEqual(entry.orchestration, orchestration)) {
    return entry
  }
  // Why: runtime graph metadata can arrive after a hook status ping. Keep old
  // fields only for the same dispatch; a reused terminal must not inherit a
  // previous worker's stale parent.
  return { ...entry, orchestration }
}
