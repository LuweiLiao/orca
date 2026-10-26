import { formatOrcaSessionAddress, type OrcaSessionId } from '../../shared/orca-session-address'
import type { OrchestrationCompatibilityEvidence } from '../../shared/orchestration-compatibility-evidence'
import type { OrchestrationSessionCaller } from './orchestration/orchestration-caller-identity'
import type { OrcaRuntimeService } from './orca-runtime'

/** A chat holds grants by its `/clear` lineage root, so a cleared chat keeps its task's grant. */
export function sessionDelegationHolderKey(orcaSessionId: OrcaSessionId): string {
  return formatOrcaSessionAddress(orcaSessionId)
}

/** A terminal agent holds grants by its exact process: a restarted agent is a new conversation. */
export function terminalDelegationHolderKey(paneKey: string, processIncarnation: string): string {
  return `pane:${paneKey}#${processIncarnation}`
}

/**
 * Whose grants an orchestration caller spends. A session the dispatch entry resolved from the
 * caller's injected Orca session id, or a terminal whose launch secret attests the declared
 * `--from`. A bare `--from`, a Run bound by `run-use` or stripped evidence proves no conversation.
 */
export function resolveAgentDelegationHolderKey(
  runtime: Pick<OrcaRuntimeService, 'verifyOrchestrationCompatibilityCaller'>,
  caller: {
    from: string | undefined
    session: OrchestrationSessionCaller | undefined
    evidence: OrchestrationCompatibilityEvidence | undefined
  }
): string | null {
  if (caller.session) {
    return sessionDelegationHolderKey(caller.session.orcaSessionId)
  }
  if (!caller.from || !caller.evidence) {
    return null
  }
  const attested = runtime.verifyOrchestrationCompatibilityCaller(caller.evidence, {
    currentRuntimeLaunchSufficient: true
  })
  return attested && attested.terminalHandle === caller.from
    ? terminalDelegationHolderKey(attested.paneKey, attested.processIncarnation)
    : null
}
