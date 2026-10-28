import { translate } from '@/i18n/i18n'
import { callRuntimeRpc, runtimeEnvironmentSupportsCapability } from '@/runtime/runtime-rpc-client'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import { structuredSessionOperationId } from '@/components/native-chat/structured-agent-session-operation-id'
import { agentSessionWriteFailureText } from '@/components/native-chat/agent-session-write-notice-text'
import type { AgentSessionMutationResult } from '../../../../shared/agent-session-wire'
import {
  agentSessionRefusalFailure,
  agentSessionThrownFailure
} from '../../../../shared/agent-session-write-failure'
import { structuredAgentSessionPayloadFingerprint } from '../../../../shared/structured-agent-session-mutation'
import { AGENT_SESSION_CONVERSATION_STOP_RUNTIME_CAPABILITY } from '../../../../shared/agent-session-stop-capabilities'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { ProjectMapStopRoute } from './project-map-stop-route'

const LOCAL: RuntimeClientTarget = { kind: 'local' }

/** A Stop that did not happen, worded for the person. */
export class ProjectMapStopError extends Error {}

type WorkerStopReceipt = { state?: string; lastError?: string | null }

function chatTarget(route: Extract<ProjectMapStopRoute, { kind: 'chat' }>): RuntimeClientTarget {
  const target = structuredAgentSessionTargetForHost(route.executionHostId)
  if (!target) {
    throw new ProjectMapStopError(
      translate('projectMap.stop.error.unreachable', 'Its host cannot be reached.')
    )
  }
  return target
}

async function chatStopSupported(target: RuntimeClientTarget): Promise<boolean> {
  if (target.kind === 'local') {
    return true
  }
  return runtimeEnvironmentSupportsCapability(
    target.environmentId,
    AGENT_SESSION_CONVERSATION_STOP_RUNTIME_CAPABILITY
  ).catch(() => false)
}

/**
 * Stops one node's work and throws a ProjectMapStopError saying why when it could not. A host
 * that predates stopping a whole conversation is refused, never stopped some other way: its Stop
 * needs a turn id and a fence only the open chat holds.
 */
export async function stopProjectMapRoute(route: ProjectMapStopRoute): Promise<void> {
  if (route.kind === 'worker') {
    let receipt: WorkerStopReceipt
    try {
      receipt = await callRuntimeRpc<WorkerStopReceipt>(LOCAL, 'orchestration.workerStop', {
        dispatch: route.dispatchId
      })
    } catch (error) {
      throw new ProjectMapStopError(error instanceof Error ? error.message : String(error))
    }
    if (receipt.state !== 'stopped') {
      throw new ProjectMapStopError(
        receipt.lastError ??
          translate('projectMap.stop.error.unconfirmed', 'The stop was not confirmed.')
      )
    }
    return
  }
  const target = chatTarget(route)
  if (!(await chatStopSupported(target))) {
    throw new ProjectMapStopError(
      translate('projectMap.stop.error.hostTooOld', 'Its host is too old to stop it from here.')
    )
  }
  const fields = {}
  let result: AgentSessionMutationResult<unknown>
  try {
    result = await callRuntimeRpc<AgentSessionMutationResult<unknown>>(
      target,
      'agentSession.cancel',
      {
        envelope: {
          sessionId: route.sessionId,
          clientOperationId: structuredSessionOperationId(),
          expectedRuntimeFence: null,
          payloadFingerprint: structuredAgentSessionPayloadFingerprint({
            method: 'agentSession.cancel',
            sessionId: route.sessionId,
            fields
          })
        },
        ...fields
      }
    )
  } catch (error) {
    throw new ProjectMapStopError(
      agentSessionWriteFailureText(
        agentSessionThrownFailure(
          error,
          error instanceof RuntimeRpcCallError ? error.code : undefined
        ),
        'stop'
      )
    )
  }
  if (!result.ok) {
    throw new ProjectMapStopError(
      agentSessionWriteFailureText(agentSessionRefusalFailure(result.refusal), 'stop')
    )
  }
}
