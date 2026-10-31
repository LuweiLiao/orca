import { parseExecutionHostId } from '../../../../shared/execution-host'
import { PROJECT_FLOW_RUNTIME_CAPABILITY } from '../../../../shared/project-flow-event'

/**
 * Whether this host sends `projectFlow` events. This machine and its SSH targets are driven by the
 * app itself; another runtime says so in its capabilities, and one that does not (or is not known
 * yet) is followed by inferring flights from its dispatch states.
 */
export function hostPublishesProjectFlow(
  executionHostId: string | null | undefined,
  capabilitiesOf: (environmentId: string) => readonly string[] | undefined
): boolean {
  const host = parseExecutionHostId(executionHostId)
  if (!host || host.kind !== 'runtime') {
    return true
  }
  return capabilitiesOf(host.environmentId)?.includes(PROJECT_FLOW_RUNTIME_CAPABILITY) === true
}
