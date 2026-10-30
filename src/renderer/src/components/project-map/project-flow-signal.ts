/** What a flight means: a delegation going down, or a worker's outcome coming back up. */
export type FlowSignalTone = 'delegate' | 'success' | 'failure'

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

/** A page-level channel; signals nobody is listening for are dropped, never replayed. */
export function createFlowSignalBus(): FlowSignalBus {
  const listeners = new Set<(signal: FlowSignal) => void>()
  return {
    publish: (signal) => {
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
