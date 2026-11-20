import type { OrcaRuntimeService } from '../../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../../orchestration/db/orchestration-db'
import { completeWorkerTerminalRelease } from './worker-release-completion'

/** Release the failed attempt's terminal on retry-of: archive output, preserve user takeover and retain interrupted cleanup for recovery.
 * Best-effort only; cleanup never blocks or fails the new start. */
export function releaseRetriedWorkerTerminal(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  start: { retryOf?: string; terminal?: string }
): void {
  const { retryOf } = start
  // An explicit `--terminal` may be the failed attempt's own pane, now taken by the retry.
  if (!retryOf || start.terminal) {
    return
  }
  try {
    const owned = db.getWorkerTerminalResourceByOwner(retryOf)
    if (
      db.getWorkerDispatch(retryOf)?.state !== 'failed' ||
      owned?.ownership_state !== 'owned' ||
      owned.release_state !== 'not_requested'
    ) {
      return
    }
    const requested = db.requestWorkerTerminalRelease(retryOf)
    if (requested.disposition !== 'requested') {
      return
    }
    void completeWorkerTerminalRelease({
      runtime,
      db,
      dispatchId: retryOf,
      resource: requested.resource
    }).then(
      (receipt) => {
        // Nobody reads this receipt, so an unproven close must at least leave a trace.
        if (receipt.state !== 'released' && receipt.state !== 'already_released') {
          console.warn('[orchestration] retried worker terminal not released', retryOf, receipt)
        }
      },
      (error: unknown) => {
        console.warn('[orchestration] retried worker terminal release failed', retryOf, error)
      }
    )
  } catch (error) {
    console.warn('[orchestration] retried worker terminal release failed', retryOf, error)
  }
}

/** Whether `retryOf` is a retry the Dispatch start admits: the Task's latest, failed attempt. */
export function isRetryOfLatestFailedAttempt(
  db: OrchestrationDb,
  start: { retryOf?: string; taskId?: string }
): boolean {
  const { retryOf, taskId } = start
  if (retryOf === undefined || taskId === undefined) {
    return false
  }
  const prior = db.getDispatchContextById(retryOf)
  const status = db.getTask(taskId)?.status
  return (
    db.getWorkerDispatch(retryOf)?.state === 'failed' &&
    prior?.task_id === taskId &&
    // A circuit-broken Task is refused, so its last attempt's pane stays for the user.
    prior.status !== 'circuit_broken' &&
    (status === 'failed' || status === 'blocked') &&
    db.getDispatchContext(taskId)?.id === retryOf
  )
}
