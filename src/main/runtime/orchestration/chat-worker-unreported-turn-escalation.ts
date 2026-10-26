import { createHash } from 'node:crypto'
import type { AgentSessionTurnCompletion } from '../../../shared/agent-session-turn-completion-wire'
import {
  chatWorkerDispatches,
  type ChatWorkerErrorEscalationDeps
} from './chat-worker-error-escalation'
import type { OrchestrationDb } from './db'
import { escalateWorkerFailure } from './worker-failure-escalation'

/** A worker coordinating its own helpers ends turns while it waits for their mail. */
function awaitsOwnHelpers(db: OrchestrationDb, dispatchId: string, runId: string): boolean {
  return (
    db.db
      .prepare(
        `SELECT 1 FROM dispatch_contexts
         WHERE creator_dispatch_id = ? AND run_id = ? AND status IN ('pending', 'dispatched')
         LIMIT 1`
      )
      .get(dispatchId, runId) !== undefined
  )
}

/**
 * A chat worker whose turn ended cleanly while its Dispatch is still open sent no `worker_done`,
 * and nothing else will wake a coordinator that ended its own turn. Failed turns have their own
 * error mail; a stop, a supersede, or a prompt waiting on the user is not the worker going idle.
 */
export function escalateChatWorkerUnreportedTurn(
  completion: AgentSessionTurnCompletion,
  deps: ChatWorkerErrorEscalationDeps
): void {
  try {
    if (completion.outcome !== 'success' || completion.awaitingUser || !deps.enabled()) {
      return
    }
    const db = deps.db()
    if (!db) {
      return
    }
    for (const { dispatch, from } of chatWorkerDispatches(completion.sessionId, db)) {
      if (awaitsOwnHelpers(db, dispatch.id, dispatch.run_id)) {
        continue
      }
      escalateWorkerFailure(
        db,
        dispatch,
        {
          id: `msg_chatidle_${createHash('sha256')
            .update(JSON.stringify([dispatch.id, completion.sessionId, completion.turnId]))
            .digest('hex')
            .slice(0, 24)}`,
          from,
          describe: (task) => ({
            subject: 'Agent ended its turn without reporting',
            body: [
              `Worker ${from} ended a turn on task ${task} without sending worker_done.`,
              'The task is still assigned to this chat. Read its transcript, then reply to continue it or decide its outcome.'
            ].join('\n')
          }),
          payload: {
            taskId: dispatch.task_id,
            dispatchId: dispatch.id,
            handle: from,
            sessionId: completion.sessionId,
            turnId: completion.turnId,
            turnOutcome: completion.outcome,
            reason: 'turn_ended_without_worker_done'
          }
        },
        deps.notify
      )
    }
  } catch (error) {
    console.warn(
      '[orchestration] chat worker unreported-turn escalation failed',
      completion.sessionId,
      error
    )
  }
}
