import type { AgentJournalSubmission } from '../../../../../../shared/agent-session-journal-types'
import { parseOrcaSessionAddress } from '../../../../../../shared/orca-session-address'
import { getStructuredAgentSessionHost } from '../../../../../native-chat/agent-session-wire/structured-agent-session-registry'
import type {
  AgentDelegationClaim,
  AgentDelegationReuse
} from '../../../../orchestration/db/delegation-grants/agent-delegation-grant-store'
import type { OrchestrationSessionCaller } from '../../../../orchestration/orchestration-caller-identity'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import {
  isRetryOfLatestFailedAttempt,
  releaseRetriedWorkerTerminal
} from './retried-worker-terminal-release'

export type WorkerStartDelegation =
  | { create: AgentDelegationClaim }
  | { reuse: AgentDelegationReuse }

/**
 * What a worker-start spends of the user's authorization: a new agent with the launch it asks for,
 * or, for `--terminal`, the agent instance it names. Model and effort are the request's own, so a
 * card that left them to the defaults matches a request that does too, whatever they resolve to.
 */
export async function resolveWorkerStartDelegation(
  runtime: Pick<OrcaRuntimeService, 'getOrchestrationDispatchAuthority'>,
  args: {
    holderKey: string | null
    callerSession: OrchestrationSessionCaller | undefined
    start: { terminal?: string; model?: string; effort?: string }
    agent: string | undefined
  }
): Promise<WorkerStartDelegation> {
  const { holderKey, start } = args
  if (start.terminal) {
    return {
      reuse: {
        holderKey,
        assignee: start.terminal,
        instance: agentInstance(runtime, start.terminal)
      }
    }
  }
  return {
    create: {
      holderKey,
      agent: args.agent ?? '',
      model: start.model ?? null,
      effort: start.effort ?? null,
      ...(args.callerSession
        ? { deliveredMessageIds: await deliveredMessageIds(args.callerSession.sessionId) }
        : {})
    }
  }
}

function agentInstance(
  runtime: Pick<OrcaRuntimeService, 'getOrchestrationDispatchAuthority'>,
  assignee: string
): AgentDelegationReuse['instance'] {
  const orcaSessionId = parseOrcaSessionAddress(assignee)
  if (orcaSessionId) {
    return { orcaSessionId }
  }
  const authority = runtime.getOrchestrationDispatchAuthority(assignee)
  return authority?.paneKey && authority.processIncarnation
    ? { paneKey: authority.paneKey, processIncarnation: authority.processIncarnation }
    : null
}

/**
 * The messages this chat's agent has been handed, from its journal: a send still queued, or one
 * the host refused, is not among them. Unreadable reads as none, which only refuses.
 */
async function deliveredMessageIds(sessionId: string): Promise<ReadonlySet<string>> {
  let submissions: readonly AgentJournalSubmission[]
  try {
    submissions =
      (await getStructuredAgentSessionHost()?.journalSnapshot(sessionId))?.submissions ?? []
  } catch {
    return new Set()
  }
  return new Set(
    submissions
      .filter(
        (submission) =>
          submission.dispatchState !== 'rejected' &&
          (submission.handedOverAt !== undefined ||
            (!submission.handoverRecorded && submission.dispatchState === 'accepted'))
      )
      .flatMap((submission) =>
        submission.queuedMessageId
          ? [submission.clientMessageId, submission.queuedMessageId]
          : [submission.clientMessageId]
      )
  )
}

/**
 * The delegation a start spends, checked before the one effect a start has ahead of its Dispatch:
 * releasing a retried attempt's terminal. An invalid retry skips both, so the Dispatch start
 * refuses it with its own reason.
 */
export async function prepareWorkerStartDelegation(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  start: {
    delegationHolderKey: string | null
    callerSession?: OrchestrationSessionCaller
    params: { terminal?: string; model?: string; effort?: string; retryOf?: string; agent?: string }
    /** The resolved agent; absent, the requested one. */
    agent?: string
    existingTask?: { id: string }
    task?: { id: string }
    run?: { id: string }
    runId?: string
    /** Its `--terminal` is a pane on another host, which no retry here takes over. */
    remote?: true
  }
): Promise<WorkerStartDelegation> {
  const { params } = start
  const taskId = (start.existingTask ?? start.task)?.id
  const runId = start.run?.id ?? start.runId ?? ''
  const delegation = await resolveWorkerStartDelegation(runtime, {
    holderKey: start.delegationHolderKey,
    callerSession: start.callerSession,
    start: params,
    agent: start.agent ?? params.agent
  })
  const retry = { retryOf: params.retryOf, taskId }
  if (retry.retryOf && retry.taskId && isRetryOfLatestFailedAttempt(db, retry)) {
    db.previewStartingWorkerDelegation(delegation, {
      taskId: retry.taskId,
      retryOf: retry.retryOf,
      runId
    })
  }
  await releaseRetriedWorkerTerminal(runtime, db, {
    ...retry,
    terminal: start.remote ? undefined : params.terminal
  })
  return delegation
}
