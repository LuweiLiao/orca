import { AGENT_DELEGATION_UNAUTHORIZED_CODE } from '../../../../shared/agent-delegation-grant'
import {
  AgentDelegationAuthorizeTerminalParams,
  AgentDelegationSettleTerminalParams
} from '../../../../shared/rpc-contract/agent-delegation-params'
import { terminalDelegationHolderKey } from '../../agent-delegation-holder'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { defineMethod, type RpcContext } from '../core'
import { rpcCallerOperationKey } from '../rpc-caller-identity'
import { isPersonClientCaller } from './agent-delegation-grant-recording'

type TerminalSubmission = { ptyId?: string; terminal?: string; submissionId: string }

/** The person's submission to one exact terminal agent process, as grant identity. */
function terminalSubmission(
  context: RpcContext,
  params: TerminalSubmission
): { holderKey: string; sourceKey: string } {
  // Why: an agent could call this as easily as it calls worker-start; only a person's app may.
  if (!isPersonClientCaller(context) || !context.caller) {
    throw new OrchestrationError(
      AGENT_DELEGATION_UNAUTHORIZED_CODE,
      'Only the Orca app or a paired device app records a person’s assignment cards. No effects were applied.',
      { effectsApplied: false, reason: 'cli_caller' }
    )
  }
  const { runtime } = context
  const target = params.ptyId ?? params.terminal ?? ''
  const authority = runtime.getOrchestrationDispatchAuthority(
    params.ptyId ? runtime.preAllocateHandleForPty(params.ptyId) : target
  )
  // The grant names this process: a restarted agent in the same pane is not the one authorized.
  if (!authority?.paneKey || !authority.processIncarnation) {
    throw new OrchestrationError(
      'terminal_not_found',
      `Terminal ${target} is not a live Orca terminal on this host, so its cards authorize nothing. No effects were applied.`,
      { effectsApplied: false }
    )
  }
  return {
    holderKey: terminalDelegationHolderKey(authority.paneKey, authority.processIncarnation),
    sourceKey: `${rpcCallerOperationKey(context.caller)}:${target}:${params.submissionId}`
  }
}

export const AGENT_DELEGATION_METHODS = [
  defineMethod({
    name: 'agentDelegation.authorizeTerminal',
    permission: 'workspace',
    params: AgentDelegationAuthorizeTerminalParams,
    handler: (params, context) => {
      const authorizationId = context.runtime.getOrchestrationDb().recordAgentDelegationGrants({
        ...terminalSubmission(context, params),
        cards: params.cards,
        awaitingDelivery: true
      })
      return { authorized: true, replayed: authorizationId === null }
    }
  }),
  defineMethod({
    name: 'agentDelegation.settleTerminal',
    permission: 'workspace',
    params: AgentDelegationSettleTerminalParams,
    handler: (params, context) => {
      context.runtime.getOrchestrationDb().settleAgentDelegationDelivery({
        ...terminalSubmission(context, params),
        delivered: params.delivered
      })
      return { settled: true }
    }
  })
]
