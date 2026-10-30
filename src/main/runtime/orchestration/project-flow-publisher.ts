import type { ProjectFlowEndpoint, ProjectFlowEvent } from '../../../shared/project-flow-event'
import type { OrchestrationDb } from './db'
import { projectFlowLogRowOf } from './db/project-flow/project-flow-log-store'

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

function recordInFlowLog(sink: ProjectFlowSink, event: ProjectFlowEvent, runId?: string): void {
  try {
    const db = sink.getExistingOrchestrationDb?.()
    if (!db) {
      return
    }
    const dispatchId = dispatchIdOf(event.from, event.to)
    const dispatch = dispatchId ? db.getDispatchContextById(dispatchId) : undefined
    db.appendProjectFlowLog(
      projectFlowLogRowOf(event, {
        ...((dispatch?.run_id ?? runId) ? { runId: dispatch?.run_id ?? runId } : {}),
        ...(dispatch?.task_id ? { taskId: dispatch.task_id } : {}),
        ...(dispatchId ? { dispatchId } : {})
      })
    )
  } catch (error) {
    console.warn('[orchestration] project flow log write failed:', error)
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
      recordInFlowLog(sink, deduped, ctx.runId)
      sink.notifyProjectFlow(deduped)
    })
    publishers.set(sink, publish)
  }
  publish(event, context)
}
