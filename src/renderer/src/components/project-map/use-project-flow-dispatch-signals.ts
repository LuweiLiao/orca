import { useEffect, useRef } from 'react'
import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import { diffDispatchSignals, type DispatchBaseline } from './project-flow-dispatch-signals'
import type { FlowSignalBus } from './project-flow-signal'

/** Publishes a flight for each dispatch that moves on while the page is open. */
export function useProjectFlowDispatchSignals(
  contexts: Readonly<Record<string, AgentStatusOrchestrationContext>>,
  bus: FlowSignalBus
): void {
  const baseline = useRef<DispatchBaseline | null>(null)
  useEffect(() => {
    const next = diffDispatchSignals(baseline.current, contexts)
    baseline.current = next.baseline
    for (const signal of next.signals) {
      bus.publish(signal)
    }
  }, [bus, contexts])
}
