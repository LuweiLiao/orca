import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import { isLocalExecutionHost } from '../../../../shared/execution-host'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentForkable } from './project-map-window-subject'

/** How a map node's work is stopped: its Dispatch's worker, or its structured chat. */
export type ProjectMapStopRoute =
  | { kind: 'worker'; dispatchId: string }
  | { kind: 'chat'; sessionId: string; executionHostId: string }

/** Why a running node cannot be stopped from the map. */
export type ProjectMapStopBlock = 'remote-host' | 'remote-worker'

export type ProjectMapStopPlan = { route: ProjectMapStopRoute } | { block: ProjectMapStopBlock }

type WorkerContext = Pick<AgentStatusOrchestrationContext, 'dispatchId' | 'dispatchStatus'> & {
  session?: Pick<NonNullable<AgentStatusOrchestrationContext['session']>, 'executionHostId'>
}

export function projectMapAgentRunning(agent: ProjectMapAgent): boolean {
  const { dotState } = agent.card
  return dotState === 'working' || dotState === 'blocked' || dotState === 'waiting'
}

function dispatchIsLive(context: WorkerContext | undefined): context is WorkerContext {
  return (
    context !== undefined &&
    context.dispatchId !== '' &&
    (context.dispatchStatus === undefined ||
      context.dispatchStatus === 'pending' ||
      context.dispatchStatus === 'dispatched')
  )
}

function isThisMachine(executionHostId: string | null | undefined): boolean {
  return executionHostId === undefined || isLocalExecutionHost(executionHostId)
}

/**
 * What stopping a node does, or null when the map offers no Stop: it is not running, it is a
 * closed chat, or it is a terminal agent with neither a Dispatch nor a structured chat.
 * A worker is stopped through its Dispatch on this app's runtime, which settles a remote
 * worker itself only with a durable request the map cannot make, so a remote one is refused.
 */
export function projectMapStopPlan(
  agent: ProjectMapAgent,
  orchestration: WorkerContext | undefined
): ProjectMapStopPlan | null {
  if (agent.history || !projectMapAgentRunning(agent)) {
    return null
  }
  if (dispatchIsLive(orchestration)) {
    const host = orchestration.session?.executionHostId ?? agent.card.executionHostId
    return isThisMachine(host)
      ? { route: { kind: 'worker', dispatchId: orchestration.dispatchId } }
      : { block: 'remote-worker' }
  }
  if (!agent.chat) {
    return null
  }
  return projectMapAgentForkable(agent) && agent.chat.executionHostId
    ? {
        route: {
          kind: 'chat',
          sessionId: agent.chat.sessionId,
          executionHostId: agent.chat.executionHostId
        }
      }
    : { block: 'remote-host' }
}
