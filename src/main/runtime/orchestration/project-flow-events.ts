import type { ProjectFlowEndpoint, ProjectFlowEvent } from '../../../shared/project-flow-event'
import { parseOrcaSessionAddress } from '../../../shared/orca-session-address'
import type { LifecycleReconciliationResult } from './lifecycle-reconciliation'
import type { OrchestrationCoordinatorKey } from './orchestration-caller-identity'
import type { MessageRow } from './types'

/** A dispatch the host accepted: the coordinator hands the worker its task. */
export function delegateFlowEvent(dispatchId: string): ProjectFlowEvent {
  return {
    type: 'projectFlow',
    id: `${dispatchId}:dispatched`,
    flow: 'delegate',
    from: { kind: 'coordinator', dispatchId },
    to: { kind: 'worker', dispatchId }
  }
}

/** Only a report the host settled; a rejected, stale or ignored message reports nothing. */
export function reportFlowEvent(result: LifecycleReconciliationResult): ProjectFlowEvent | null {
  if (result.action !== 'completed' && result.action !== 'failed') {
    return null
  }
  const { dispatchId } = result
  return {
    type: 'projectFlow',
    id: `${dispatchId}:${result.action}`,
    flow: 'report',
    outcome: result.action === 'completed' ? 'succeeded' : 'failed',
    from: { kind: 'worker', dispatchId },
    to: { kind: 'coordinator', dispatchId }
  }
}

type FlowParty = { paneKey?: string | null; orcaSessionId?: string | null }

export type FlowAddressResolver = {
  runCoordinator: (
    runId: string
  ) => Pick<OrchestrationCoordinatorKey, 'paneKey' | 'orcaSessionId'> | null
  paneKeyOfHandle: (handle: string) => string | null
}

// Why: a chat's node is named by its session; a structured worker's minted pane key is another id.
function partyEndpoint(party: FlowParty | null | undefined): ProjectFlowEndpoint | null {
  if (party?.orcaSessionId) {
    return { kind: 'session', sessionId: party.orcaSessionId }
  }
  return party?.paneKey ? { kind: 'pane', paneKey: party.paneKey } : null
}

function recipientEndpoint(
  address: string,
  resolver: FlowAddressResolver
): ProjectFlowEndpoint | null {
  if (address.startsWith('dispatch:')) {
    const dispatchId = address.slice('dispatch:'.length)
    return dispatchId ? { kind: 'worker', dispatchId } : null
  }
  if (address.startsWith('run:')) {
    return partyEndpoint(resolver.runCoordinator(address.slice('run:'.length)))
  }
  const sessionId = parseOrcaSessionAddress(address)
  if (sessionId) {
    return { kind: 'session', sessionId }
  }
  const paneKey = resolver.paneKeyOfHandle(address)
  return paneKey ? { kind: 'pane', paneKey } : null
}

/**
 * A hand-off or a merge-ready note, drawn from its sender to whoever it was addressed to. A note
 * that is not for one of these, or whose ends are not known here, flies nowhere.
 */
export function messageFlowEvent(
  message: Pick<MessageRow, 'id' | 'type' | 'to_handle'>,
  sender: FlowParty,
  resolver: FlowAddressResolver
): ProjectFlowEvent | null {
  if (message.type !== 'handoff' && message.type !== 'merge_ready') {
    return null
  }
  const from = partyEndpoint(sender)
  const to = recipientEndpoint(message.to_handle, resolver)
  if (!from || !to) {
    return null
  }
  return {
    type: 'projectFlow',
    id: `message:${message.id}`,
    flow: message.type === 'handoff' ? 'handoff' : 'merge-ready',
    from,
    to
  }
}

/** Only for a merge the host itself saw succeed; a queued auto-merge is not one. */
export function mergeFlowEvent(repoId: string, prNumber: number): ProjectFlowEvent {
  return {
    type: 'projectFlow',
    id: `merge:${repoId}:${prNumber}`,
    flow: 'merge',
    from: { kind: 'pull-request', repoId, prNumber },
    to: { kind: 'pull-request-base', repoId, prNumber }
  }
}
