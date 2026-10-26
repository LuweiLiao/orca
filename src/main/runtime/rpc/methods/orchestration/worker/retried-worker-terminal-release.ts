import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { resolveStructuredWorkerForDispatch } from '../../orchestration-structured-worker-lifecycle'
import { observeStructuredWorker } from '../../../../structured-worker-authority'
import { WORKER_RETRY_PRIOR_ATTEMPT_LIVE_CODE } from '../../../../../../shared/agent-delegation-grant'
import { completeWorkerTerminalRelease } from './worker-release-completion'

/**
 * A `--retry-of` start replaces a failed attempt, so the terminal or chat session that attempt
 * still owns goes through the same release as `worker-release`: output archived, a user takeover
 * kept, and a release cut short by a restart finished by recovery. The retry reuses the attempt's
 * authorized agent, so it waits for that and refuses while the attempt's agent may still run.
 */
export async function releaseRetriedWorkerTerminal(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  start: { retryOf?: string; terminal?: string; taskId?: string }
): Promise<void> {
  const { retryOf } = start
  // An explicit `--terminal` may be the failed attempt's own pane, now taken by the retry.
  if (!retryOf || start.terminal || db.getWorkerDispatch(retryOf)?.state !== 'failed') {
    return
  }
  // Only the retry the Dispatch start will admit releases anything: the Task's latest attempt.
  if (!isRetryOfLatestFailedAttempt(db, { retryOf, taskId: start.taskId })) {
    return
  }
  let lastError: string | undefined
  if (ownsUnreleasedAgentTerminal(db, retryOf)) {
    try {
      const requested = db.requestWorkerTerminalRelease(retryOf)
      if (requested.disposition === 'requested') {
        const receipt = await completeWorkerTerminalRelease({
          runtime,
          db,
          dispatchId: retryOf,
          resource: requested.resource
        })
        lastError = receipt.lastError
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  const resource = db.getWorkerTerminalResourceByOwner(retryOf)
  const structured = resolveStructuredWorkerForDispatch(db, retryOf)
  // A failed structured start's teardown only logs a close that threw, so a released or missing
  // resource proves nothing: only its session lineage observed exited does. A session the user
  // took over is theirs, as a taken-over pane is.
  const takenOver =
    resource?.ownership_state === 'user_owned' ||
    resource?.ownership_state === 'transferred' ||
    resource?.ownership_state === 'external'
  const stillRuns = structured
    ? !takenOver && observeStructuredWorker(structured).status !== 'exited'
    : ownsUnreleasedAgentTerminal(db, retryOf)
  if (!stillRuns) {
    return
  }
  throw new OrchestrationError(
    WORKER_RETRY_PRIOR_ATTEMPT_LIVE_CODE,
    `Dispatch ${retryOf}'s agent ${resource?.terminal_handle ?? structured?.handle ?? ''} was not proven closed (release ${resource?.release_state ?? 'unknown'}), so it may still run and no second agent was started. Run worker-release or worker-stop for Dispatch ${retryOf}, then retry.`,
    {
      dispatchId: retryOf,
      releaseState: resource?.release_state ?? null,
      ...(lastError ? { lastError } : {})
    }
  )
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

function ownsUnreleasedAgentTerminal(db: OrchestrationDb, dispatchId: string): boolean {
  const owned = db.getWorkerTerminalResourceByOwner(dispatchId)
  return owned?.ownership_state === 'owned' && owned.release_state !== 'released'
}
