import type { ProjectFlowEndpoint, ProjectFlowEvent } from '../../../shared/project-flow-event'
import type { OrchestrationDb } from './db'
import { projectFlowLogRowOf } from './db/project-flow/project-flow-log-store'
import { currentRunCoordinatorOrcaSessionId } from './db/runs/run-coordinator-orca-session'
import { chatAssigneeSessionId } from './chat-assignee'
import { sessionIdFromStructuredWorkerIncarnation } from '../structured-worker-identity'

const RECENT_ID_WINDOW_MS = 60_000
const MAX_RECENT_IDS = 512

export type PublishContext = { runId?: string }

/** Sends each occurrence once: a retry or a repeated report of the same thing is not a second one. */
export function createProjectFlowPublisher(
  emit: (event: ProjectFlowEvent, context: PublishContext) => void,
  now: () => number = Date.now
): (event: ProjectFlowEvent, context?: PublishContext) => void {
  const recent = new Map<string, number>()
  return (event, context = {}) => {
    const at = now()
    for (const [id, seenAt] of recent) {
      if (at - seenAt > RECENT_ID_WINDOW_MS || recent.size > MAX_RECENT_IDS) {
        recent.delete(id)
      } else {
        break
      }
    }
    if (recent.has(event.id)) {
      return
    }
    recent.set(event.id, at)
    emit(event, context)
  }
}

export type ProjectFlowSink = {
  notifyProjectFlow: (event: ProjectFlowEvent) => void
  /** The flow log's database when one is open; a host with none records nothing. */
  getExistingOrchestrationDb?: () => OrchestrationDb | null
}

const publishers = new WeakMap<ProjectFlowSink, ReturnType<typeof createProjectFlowPublisher>>()

function dispatchIdOf(...ends: ProjectFlowEndpoint[]): string | undefined {
  for (const end of ends) {
    if (end.kind === 'worker' || end.kind === 'coordinator') {
      return end.dispatchId
    }
  }
  return undefined
}

type DispatchSessions = { worker: string | null; coordinator: string | null }

/** Names each dispatch end by its chat, so a viewer can place it after the dispatch is gone. */
function withSessions(event: ProjectFlowEvent, sessions: DispatchSessions): ProjectFlowEvent {
  const named = (end: ProjectFlowEndpoint): ProjectFlowEndpoint => {
    if (end.kind !== 'worker' && end.kind !== 'coordinator') {
      return end
    }
    const sessionId = end.kind === 'worker' ? sessions.worker : sessions.coordinator
    return sessionId && !end.sessionId ? { ...end, sessionId } : end
  }
  return { ...event, from: named(event.from), to: named(event.to) }
}

/** Writes the event to the flow log and returns it with its dispatch ends named by session. */
function recordInFlowLog(
  sink: ProjectFlowSink,
  event: ProjectFlowEvent,
  runId?: string
): ProjectFlowEvent {
  try {
    const db = sink.getExistingOrchestrationDb?.()
    if (!db) {
      return event
    }
    const dispatchId = dispatchIdOf(event.from, event.to)
    const dispatch = dispatchId ? db.getDispatchContextById(dispatchId) : undefined
    const run = dispatch?.run_id ? db.getRun(dispatch.run_id) : undefined
    const named = withSessions(event, {
      worker:
        sessionIdFromStructuredWorkerIncarnation(dispatch?.process_incarnation) ??
        chatAssigneeSessionId(dispatch?.assignee_handle),
      coordinator: run ? currentRunCoordinatorOrcaSessionId(run) : null
    })
    db.appendProjectFlowLog(
      projectFlowLogRowOf(named, {
        ...((dispatch?.run_id ?? runId) ? { runId: dispatch?.run_id ?? runId } : {}),
        ...(dispatch?.task_id ? { taskId: dispatch.task_id } : {}),
        ...(dispatchId ? { dispatchId } : {})
      })
    )
    return named
  } catch (error) {
    console.warn('[orchestration] project flow log write failed:', error)
    return event
  }
}

/**
 * Call only after the transaction that made the fact true has committed. The event is written to
 * the host's flow log and then sent to viewers; a failed write never stops the send.
 */
export function publishProjectFlow(
  sink: ProjectFlowSink,
  event: ProjectFlowEvent,
  context: PublishContext = {}
): void {
  let publish = publishers.get(sink)
  if (!publish) {
    publish = createProjectFlowPublisher((deduped, ctx) => {
      sink.notifyProjectFlow(recordInFlowLog(sink, deduped, ctx.runId))
    })
    publishers.set(sink, publish)
  }
  publish(event, context)
}
