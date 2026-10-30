import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import { PROJECT_FLOW_HISTORY_RUNTIME_CAPABILITY } from '../../../../shared/project-flow-history'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { runtimeEnvironmentSupportsCapability } from '@/runtime/rpc/compatibility/runtime-capability-proof'
import type {
  ProjectFlowHistoryHost,
  ProjectFlowHistorySource
} from './project-flow-history-reader'

/** This machine's host and each known runtime environment, as the timeline names them. */
export function projectFlowHistoryHosts(
  environmentIds: readonly string[]
): ProjectFlowHistoryHost[] {
  return [
    { hostId: LOCAL_EXECUTION_HOST_ID, target: { kind: 'local' } },
    ...environmentIds.map((environmentId) => ({
      hostId: toRuntimeExecutionHostId(environmentId),
      target: { kind: 'environment' as const, environmentId }
    }))
  ]
}

export const runtimeProjectFlowHistorySource: ProjectFlowHistorySource = {
  // Why: this build always serves it; a runtime says so in its capabilities, and an older one does not.
  supportsHistory: async (target) =>
    target.kind === 'local' ||
    runtimeEnvironmentSupportsCapability(
      target.environmentId,
      PROJECT_FLOW_HISTORY_RUNTIME_CAPABILITY
    ),
  fetchPage: (target, params) => callRuntimeRpc(target, 'projectFlow.history', params)
}
