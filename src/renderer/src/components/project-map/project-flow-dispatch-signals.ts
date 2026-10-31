import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import type { FlowSignal } from './project-flow-signal'

type DispatchContext = Pick<
  AgentStatusOrchestrationContext,
  'dispatchId' | 'dispatchStatus' | 'parentPaneKey'
>

export type DispatchBaseline = ReadonlyMap<
  string,
  { dispatchId: string; status: AgentStatusOrchestrationContext['dispatchStatus'] }
>

/**
 * Compares each worker's dispatch with the last one seen. The first snapshot only sets the
 * baseline, so opening the page never replays what already happened.
 */
export function diffDispatchSignals(
  previous: DispatchBaseline | null,
  contexts: Readonly<Record<string, DispatchContext>>,
  hostSendsFlow: (paneKey: string) => boolean = () => false
): { signals: FlowSignal[]; baseline: DispatchBaseline } {
  const baseline = new Map<
    string,
    { dispatchId: string; status: DispatchContext['dispatchStatus'] }
  >()
  const signals: FlowSignal[] = []
  for (const [paneKey, context] of Object.entries(contexts)) {
    baseline.set(paneKey, { dispatchId: context.dispatchId, status: context.dispatchStatus })
    const parent = context.parentPaneKey
    if (!previous || !parent || parent === paneKey) {
      continue
    }
    const before = previous.get(paneKey)
    const status = before?.dispatchId === context.dispatchId ? before.status : undefined
    const id = `${context.dispatchId}:${context.dispatchStatus}`
    // Why: the runtime publishes a new worker already `dispatched`, so `pending` is rarely seen.
    // Why: a host that sends its own events tells delegations and reports; a tripped breaker is
    // no report, so only this viewer can tell it from the state.
    const formal = hostSendsFlow(paneKey)
    const delegated =
      context.dispatchStatus === 'dispatched' && (status === undefined || status === 'pending')
    if (delegated) {
      if (!formal) {
        signals.push({ id, from: parent, to: paneKey, tone: 'delegate' })
      }
    } else if (status === 'dispatched' && context.dispatchStatus === 'completed') {
      if (!formal) {
        signals.push({ id, from: paneKey, to: parent, tone: 'success' })
      }
    } else if (status === 'dispatched' && context.dispatchStatus === 'failed') {
      if (!formal) {
        signals.push({ id, from: paneKey, to: parent, tone: 'failure' })
      }
    } else if (status === 'dispatched' && context.dispatchStatus === 'circuit_broken') {
      signals.push({ id, from: paneKey, to: parent, tone: 'failure' })
    }
  }
  // Why: a pane that drops out for a snapshot (a reconnect) must not fly its delegation again.
  for (const [paneKey, seen] of previous ?? []) {
    if (!baseline.has(paneKey)) {
      baseline.set(paneKey, seen)
    }
  }
  return { signals, baseline }
}
