import { useAppStore } from '@/store'
import { useStructuredAgentSessionHostCapabilityState } from '@/runtime/structured-agent-session-host-capability'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import { AGENT_SESSION_CONVERSATION_STOP_RUNTIME_CAPABILITY } from '../../../../shared/agent-session-stop-capabilities'
import type { ProjectMapAgent } from './project-map-graph'
import type { ProjectMapActionBlock } from './project-map-node-actions'
import { projectMapStopPlan } from './project-map-stop-route'

/**
 * Whether the menu offers Stop on a node, and why it is greyed: absent when the node is not
 * running or has nothing the map can stop. Only a chat needs its host's word; a worker is
 * stopped on this app's runtime.
 */
export function useProjectMapStopOffer(
  agent: ProjectMapAgent | undefined
): { block: ProjectMapActionBlock | null } | undefined {
  const orchestration = useAppStore((s) =>
    agent ? s.runtimeAgentOrchestrationByPaneKey[agent.card.paneKey] : undefined
  )
  const plan = agent ? projectMapStopPlan(agent, orchestration) : null
  const chat = plan && 'route' in plan && plan.route.kind === 'chat' ? plan.route : null
  const state = useStructuredAgentSessionHostCapabilityState(
    chat ? structuredAgentSessionTargetForHost(chat.executionHostId) : null,
    AGENT_SESSION_CONVERSATION_STOP_RUNTIME_CAPABILITY
  )
  if (!plan) {
    return undefined
  }
  if ('block' in plan) {
    return { block: plan.block }
  }
  if (!chat) {
    return { block: null }
  }
  return {
    block:
      state === 'supported'
        ? null
        : state === 'unsupported'
          ? 'stop-host-too-old'
          : 'host-unreachable'
  }
}
