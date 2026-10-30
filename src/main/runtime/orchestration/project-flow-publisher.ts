import type { ProjectFlowEvent } from '../../../shared/project-flow-event'

const RECENT_ID_WINDOW_MS = 60_000
const MAX_RECENT_IDS = 512

/** Sends each occurrence once: a retry or a repeated report of the same thing is not a second one. */
export function createProjectFlowPublisher(
  emit: (event: ProjectFlowEvent) => void,
  now: () => number = Date.now
): (event: ProjectFlowEvent) => void {
  const recent = new Map<string, number>()
  return (event) => {
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
    emit(event)
  }
}

type ProjectFlowSink = { notifyProjectFlow: (event: ProjectFlowEvent) => void }

const publishers = new WeakMap<ProjectFlowSink, (event: ProjectFlowEvent) => void>()

/** Call only after the transaction that made the fact true has committed. */
export function publishProjectFlow(runtime: ProjectFlowSink, event: ProjectFlowEvent): void {
  let publish = publishers.get(runtime)
  if (!publish) {
    publish = createProjectFlowPublisher((deduped) => runtime.notifyProjectFlow(deduped))
    publishers.set(runtime, publish)
  }
  publish(event)
}
