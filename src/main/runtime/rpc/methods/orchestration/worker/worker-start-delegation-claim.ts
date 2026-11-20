import { parseOrcaSessionAddress } from '../../../../../../shared/agent-session/identity/orca-session-address'
import { AGENT_SESSION_HISTORY_MAX_LIMIT } from '../../../../../../shared/agent-session/agent-session-wire'
import type { AgentJournalSubmission } from '../../../../../../shared/agent-session/journal/agent-session-journal-types'
import { getStructuredAgentSessionHost } from '../../../../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../../../../../native-chat/agent-session-wire/host/structured-agent-session-host'
import type {
  AgentDelegationClaim,
  AgentDelegationReuse
} from '../../../../orchestration/db/delegation-grants/agent-delegation-grant-store'
import {
  sessionCallerOf,
  type OrchestrationEntryCaller,
  type OrchestrationSessionCaller
} from '../../../../orchestration/addressing/orchestration-caller-identity'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db/orchestration-db'
import {
  isRetryOfLatestFailedAttempt,
  releaseRetriedWorkerTerminal
} from './release/retried-worker-terminal-release'

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

// The message whose cards a chat acts on is among its latest; older ones were settled long since.
const DELIVERY_HISTORY_PAGES = 5

/**
 * The messages this chat's agent has been handed, from its recent journal: a send still queued, or
 * one the host refused, is not among them. Unreadable reads as none, which only refuses.
 */
async function deliveredMessageIds(sessionId: string): Promise<ReadonlySet<string>> {
  const host = getStructuredAgentSessionHost()
  const submissions: AgentJournalSubmission[] = []
  try {
    let request: Parameters<StructuredAgentSessionHost['history']>[0] = {
      sessionId,
      direction: 'tail',
      limit: AGENT_SESSION_HISTORY_MAX_LIMIT
    }
    for (let read = 0; host && read < DELIVERY_HISTORY_PAGES; read++) {
      const result = await host.history(request)
      if (!result.ok) {
        break
      }
      submissions.push(...result.page.submissions)
      const oldest = result.page.window.oldest
      if (!result.page.hasOlder || !oldest) {
        break
      }
      request = { sessionId, direction: 'before', cursor: oldest, limit: request.limit }
    }
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
    /** Absent: this start spends no authorization (a follow-up, or a paired Orca's coordinator). */
    delegationHolderKey?: string | null
    callerSession?: OrchestrationEntryCaller
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
): Promise<WorkerStartDelegation | undefined> {
  const { params } = start
  const taskId = (start.existingTask ?? start.task)?.id
  // A retry's Task already has its Run, which the start binds again.
  const runId = start.run?.id ?? start.runId ?? (taskId ? db.getTask(taskId)?.run_id : '') ?? ''
  const delegation =
    start.delegationHolderKey === undefined
      ? undefined
      : await resolveWorkerStartDelegation(runtime, {
          holderKey: start.delegationHolderKey,
          callerSession: sessionCallerOf(start.callerSession),
          start: params,
          agent: start.agent ?? params.agent
        })
  const retry = { retryOf: params.retryOf, taskId }
  if (delegation && retry.retryOf && retry.taskId && isRetryOfLatestFailedAttempt(db, retry)) {
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
