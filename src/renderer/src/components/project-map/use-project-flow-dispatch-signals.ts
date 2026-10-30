import { useEffect, useRef } from 'react'
import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import { useAppStore } from '@/store'
import { diffDispatchSignals, type DispatchBaseline } from './project-flow-dispatch-signals'
import { hostPublishesProjectFlow } from './project-flow-host-support'
import type { FlowSignalBus } from './project-flow-signal'

/**
 * Publishes a flight for each dispatch that moves on while the page is open, for the hosts that
 * do not send their own events.
 */
export function useProjectFlowDispatchSignals(
  contexts: Readonly<Record<string, AgentStatusOrchestrationContext>>,
  bus: FlowSignalBus
): void {
  const baseline = useRef<DispatchBaseline | null>(null)
  useEffect(() => {
    const { runtimeStatusByEnvironmentId } = useAppStore.getState()
    const hostSendsFlow = (paneKey: string): boolean => {
      const context = contexts[paneKey]
      const hostId = context?.session?.executionHostId ?? context?.parentSession?.executionHostId
      return hostPublishesProjectFlow(
        hostId,
        (environmentId) => runtimeStatusByEnvironmentId.get(environmentId)?.status?.capabilities
      )
    }
    const next = diffDispatchSignals(baseline.current, contexts, hostSendsFlow)
    baseline.current = next.baseline
    for (const signal of next.signals) {
      bus.publish(signal)
    }
  }, [bus, contexts])
}
