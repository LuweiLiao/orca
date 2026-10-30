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
  contexts: Readonly<Record<string, DispatchContext>>
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
    const delegated =
      context.dispatchStatus === 'dispatched' && (status === undefined || status === 'pending')
    if (delegated) {
      signals.push({ id, from: parent, to: paneKey, tone: 'delegate' })
    } else if (status === 'dispatched' && context.dispatchStatus === 'completed') {
      signals.push({ id, from: paneKey, to: parent, tone: 'success' })
    } else if (status === 'dispatched' && context.dispatchStatus === 'failed') {
      signals.push({ id, from: paneKey, to: parent, tone: 'failure' })
    }
  }
  return { signals, baseline }
}
