import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { LifecycleReconciliationResult } from '../../../../orchestration/lifecycle-reconciliation'
import { runCoordinatorKey } from '../../../../orchestration/orchestration-caller-identity'
import { messageFlowEvent, reportFlowEvent } from '../../../../orchestration/project-flow-events'
import { publishProjectFlow } from '../../../../orchestration/project-flow-publisher'
import type { MessageRow } from '../../../../orchestration/types'

export type FlowSender = { paneKey?: string | null; orcaSessionId?: string | null }

/** After a message committed: tell viewers about a settled report, a hand-off or a merge-ready note. */
export function publishMessageFlow(args: {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  message: Pick<MessageRow, 'id' | 'type' | 'to_handle'>
  sender: FlowSender
  reconciled?: LifecycleReconciliationResult
}): void {
  const { runtime, db, message, sender, reconciled } = args
  const event =
    message.type === 'worker_done' && reconciled
      ? reportFlowEvent(reconciled)
      : messageFlowEvent(message, sender, {
          runCoordinator: (runId) => {
            const run = db.getRun(runId)
            return run ? runCoordinatorKey(run) : null
          },
          paneKeyOfHandle: (handle) => runtime.getTerminalPaneKey(handle)
        })
  if (event) {
    publishProjectFlow(runtime, event)
  }
}
