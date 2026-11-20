// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { acceptedAgentStatuses } from '@/store/slices/agent-status/status-ownership/accepted-agent-statuses'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import {
  hiddenWorkerTabIds,
  resetRevealedWorkerTabsForTests,
  revealWorkerTab
} from './worker-tab-visibility'

const WORKER_LEAF = '11111111-1111-4111-8111-111111111111'
const COORDINATOR_LEAF = '22222222-2222-4222-8222-222222222222'

function stateWithOrchestration(context: { dispatchId: string }, leaf: string, tabId: string) {
  return {
    agentStatusByPaneKey: acceptedAgentStatuses(Object.entries({})),
    runtimeAgentOrchestrationByPaneKey: {
      [makePaneKey(tabId, leaf)]: { taskId: 'task-1', ...context }
    }
  }
}

describe('orchestration worker tabs', () => {
  afterEach(resetRevealedWorkerTabsForTests)

  it('hides a dispatched worker tab until it is revealed, and keeps it shown after', () => {
    const state = stateWithOrchestration({ dispatchId: 'ctx-1' }, WORKER_LEAF, 'worker')
    expect([...hiddenWorkerTabIds(state)]).toEqual(['worker'])
    revealWorkerTab('worker')
    expect([...hiddenWorkerTabIds(state)]).toEqual([])
  })

  it('never hides a tab without a dispatch or one that belongs to a subagent', () => {
    expect(
      hiddenWorkerTabIds(
        stateWithOrchestration({ dispatchId: '' }, COORDINATOR_LEAF, 'coordinator')
      ).size
    ).toBe(0)
    expect(
      hiddenWorkerTabIds(stateWithOrchestration({ dispatchId: 'subagent:abc' }, WORKER_LEAF, 'sub'))
        .size
    ).toBe(0)
  })
})
