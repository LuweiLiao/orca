import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { LifecycleReconciliationResult } from '../../../../orchestration/lifecycle-reconciliation'
import { publishMessageFlow } from './project-flow-publish'

function setup() {
  const notifyProjectFlow = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: publishMessageFlow only calls these two methods.
  const runtime = {
    notifyProjectFlow,
    getTerminalPaneKey: (handle: string) => (handle === 'term_a' ? 'pane-a' : null)
  } as unknown as OrcaRuntimeService
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: publishMessageFlow only calls getRun.
  const db = {
    getRun: (id: string) =>
      id === 'run1'
        ? {
            coordinator_handle: null,
            coordinator_pane_key: 'coord-pane',
            coordinator_orca_session_id: null
          }
        : undefined
  } as unknown as OrchestrationDb
  return { notifyProjectFlow, runtime, db }
}

const doneMessage = { id: 'm1', type: 'worker_done', to_handle: 'run:run1' } as const

describe('publishMessageFlow', () => {
  it('sends one report for a worker_done the host settled', () => {
    const { notifyProjectFlow, runtime, db } = setup()
    const reconciled: LifecycleReconciliationResult = {
      action: 'completed',
      taskId: 't',
      dispatchId: 'd1'
    }
    publishMessageFlow({ runtime, db, message: doneMessage, sender: {}, reconciled })
    expect(notifyProjectFlow).toHaveBeenCalledTimes(1)
    expect(notifyProjectFlow.mock.calls[0]?.[0]).toMatchObject({ id: 'd1:completed' })
  })

  it('sends nothing for a worker_done that was rejected, stale or ignored', () => {
    const { notifyProjectFlow, runtime, db } = setup()
    for (const reconciled of [
      { action: 'rejected', code: 'stale_dispatch', reason: 'old' },
      { action: 'rejected', code: 'inactive_dispatch', reason: 'ended' },
      { action: 'ignored' }
    ] as const) {
      publishMessageFlow({ runtime, db, message: doneMessage, sender: {}, reconciled })
    }
    publishMessageFlow({ runtime, db, message: doneMessage, sender: {} })
    expect(notifyProjectFlow).not.toHaveBeenCalled()
  })

  it('sends a hand-off to the run coordinator and a merge-ready note as its own kind', () => {
    const { notifyProjectFlow, runtime, db } = setup()
    publishMessageFlow({
      runtime,
      db,
      message: { id: 'm2', type: 'handoff', to_handle: 'run:run1' },
      sender: { paneKey: 'pane-w' }
    })
    publishMessageFlow({
      runtime,
      db,
      message: { id: 'm3', type: 'merge_ready', to_handle: 'term_a' },
      sender: { paneKey: 'pane-w' }
    })
    expect(notifyProjectFlow.mock.calls.map(([event]) => event.flow)).toEqual([
      'handoff',
      'merge-ready'
    ])
  })
})
