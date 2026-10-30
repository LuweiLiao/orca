/** What a flight means: a delegation, a worker's outcome, a hand-off or a merge note. */
export type FlowSignalTone =
  | 'delegate'
  | 'success'
  | 'failure'
  | 'handoff'
  | 'merge-ready'
  | 'merge'

/** One real event; `from` and `to` are the ids of whatever nodes the host surface draws. */
export type FlowSignal = {
  id: string
  from: string
  to: string
  tone: FlowSignalTone
}

export type FlowSignalBus = {
  publish: (signal: FlowSignal) => void
  subscribe: (listener: (signal: FlowSignal) => void) => () => void
}

const DEDUPE_WINDOW_MS = 10_000

/**
 * A channel for one app; signals nobody is listening for are dropped, never replayed. A signal
 * whose id was published in the last few seconds is the same occurrence told twice (a host's event
 * and a viewer's own inference), so it flies once.
 */
export function createFlowSignalBus(now: () => number = Date.now): FlowSignalBus {
  const listeners = new Set<(signal: FlowSignal) => void>()
  const seen = new Map<string, number>()
  return {
    publish: (signal) => {
      const at = now()
      for (const [id, seenAt] of seen) {
        if (at - seenAt <= DEDUPE_WINDOW_MS) {
          break
        }
        seen.delete(id)
      }
      if (seen.has(signal.id)) {
        return
      }
      seen.set(signal.id, at)
      for (const listener of listeners) {
        listener(signal)
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
