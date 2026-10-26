import { AGENT_DELEGATION_UNAUTHORIZED_CODE } from '../../../../shared/agent-delegation-grant'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { RpcContext } from '../core'
import { isPersonClientCaller } from './agent-delegation-grant-recording'
import { assertAgentLaunchTargetAuthorized } from './agent-launch-target-authorization'
import type { AgentLaunchTarget } from '../../../../shared/agent-launch-intent'

/**
 * Direct agent-creation entries serve a person's own client: this host's window, a paired phone
 * or a paired desktop or web client. The CLI, local or paired, is what every agent can reach and
 * carries no conversation a person authorized, so it starts agents only through worker-start,
 * which spends the user's grant. A shell command is not intercepted here.
 */
export function assertPersonCreatesAgent(
  context: Pick<RpcContext, 'caller' | 'clientKind' | 'clientCapabilities'>,
  entry: string
): void {
  if (isPersonClientCaller(context)) {
    return
  }
  throw new OrchestrationError(
    AGENT_DELEGATION_UNAUTHORIZED_CODE,
    `${entry} starts an agent only for the Orca app or a paired device's app. An agent creates agents with \`orca orchestration worker-start\`, within what the user authorized with an assignment card; otherwise do the work yourself or ask the user to create the agent in Orca. No effects were applied.`,
    { effectsApplied: false, reason: 'cli_caller', entry }
  )
}

/** `agent.launch` always starts an agent, and may also create the workspace it starts in. */
export function assertAgentLaunchAdmitted(
  target: Pick<AgentLaunchTarget, 'kind'>,
  context: Pick<RpcContext, 'caller' | 'clientKind' | 'clientCapabilities'>
): void {
  assertPersonCreatesAgent(context, 'agent.launch')
  assertAgentLaunchTargetAuthorized(target, context)
}
