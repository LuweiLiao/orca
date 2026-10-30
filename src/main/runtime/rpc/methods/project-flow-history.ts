import { ProjectFlowHistoryParams } from '../../../../shared/rpc-contract/project-flow-history-params'
import { defineMethod } from '../core'

export const PROJECT_FLOW_HISTORY_METHODS = [
  defineMethod({
    name: 'projectFlow.history',
    permission: 'workspace',
    params: ProjectFlowHistoryParams,
    // Why: a host that never opened its orchestration database has nothing to read, and a read
    // must not be the thing that creates it.
    handler: (params, { runtime }) =>
      runtime.getExistingOrchestrationDb()?.readProjectFlowHistory(params) ?? {
        entries: [],
        nextCursor: null
      }
  })
]
