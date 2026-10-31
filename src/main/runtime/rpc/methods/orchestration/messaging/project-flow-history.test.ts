import '../../../unused-default-rpc-methods.test-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../../core'
import { eraseRpcMethods } from '../../../core'
import { PROJECT_FLOW_HISTORY_METHODS } from '../../project-flow-history'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'
import { createRootDispatch } from '../../../../orchestration/db/root-dispatch-test-fixture'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { ProjectFlowHistoryPage } from '../../../../../../shared/project-flow-history'

describe('projectFlow.history after real orchestration calls', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  let activeRunId: string | undefined

  function setup(): void {
    ;({ db, runtime, ctx, activeRunId } = h.setup())
    vi.spyOn(runtime, 'deliverPendingMessagesForHandle').mockImplementation(() => {})
    vi.mocked(runtime.getTerminalPaneKey).mockImplementation((handle) =>
      handle === 'term_worker'
        ? 'tab_worker:leaf_worker'
        : handle === 'term_coord'
          ? h.coordinatorPaneKey
          : null
    )
  }

  afterEach(() => {
    vi.restoreAllMocks()
    h.cleanup()
  })

  async function history(params: Record<string, unknown> = {}): Promise<ProjectFlowHistoryPage> {
    const method = eraseRpcMethods(PROJECT_FLOW_HISTORY_METHODS).find(
      (candidate) => candidate.name === 'projectFlow.history'
    )
    if (!method?.params) {
      throw new Error('projectFlow.history is not registered')
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler returns a ProjectFlowHistoryPage.
    return (await method.handler(method.params.parse(params), ctx)) as ProjectFlowHistoryPage
  }

  function workerDone(taskId: string, dispatchId: string) {
    return h.call(
      'orchestration.send',
      {
        from: 'term_worker',
        to: 'term_coord',
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({ taskId, dispatchId, outcome: 'succeeded' })
      },
      ctx
    )
  }

  it('reads back exactly one report row for a settled worker_done', async () => {
    setup()
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker', 'tab_worker:leaf_worker')

    await workerDone(task.id, dispatch.id)

    const { entries, nextCursor } = await history()
    expect(nextCursor).toBeNull()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'report',
      outcome: 'succeeded',
      dispatchId: dispatch.id,
      taskId: task.id,
      runId: activeRunId,
      from: { kind: 'worker', dispatchId: dispatch.id },
      to: { kind: 'coordinator', dispatchId: dispatch.id }
    })
  })

  it('writes nothing for a worker_done the host refused', async () => {
    setup()
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(
      db,
      task.id,
      'term_worker',
      'tab_worker:leaf_worker',
      undefined,
      'runtime_test:term_worker:1'
    )
    vi.mocked(runtime.getTerminalProcessIncarnation).mockReturnValue('runtime_test:term_worker:2')

    expect(await workerDone(task.id, dispatch.id)).toMatchObject({
      lifecycle: { action: 'rejected' }
    })

    expect((await history()).entries).toEqual([])
  })

  it('does not write a second row when the same settled report is sent again', async () => {
    setup()
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker', 'tab_worker:leaf_worker')

    await workerDone(task.id, dispatch.id)
    await workerDone(task.id, dispatch.id).catch(() => undefined)

    expect((await history()).entries.filter((entry) => entry.kind === 'report')).toHaveLength(1)
  })

  it('records a hand-off and a merge-ready note as their own kinds, and neither as a merge', async () => {
    setup()
    for (const type of ['handoff', 'merge_ready'] as const) {
      await h.call(
        'orchestration.send',
        { from: 'term_worker', to: `run:${activeRunId}`, subject: type, type },
        ctx
      )
    }

    const kinds = (await history()).entries.map((entry) => entry.kind)
    expect(kinds).toEqual(['handoff', 'merge-ready'])
    expect(kinds).not.toContain('merge')
  })

  it('records a worker stage change once, and not a write that changes nothing', () => {
    setup()
    const task = db.createTask({ spec: 'work' })
    const started = db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      taskId: task.id,
      startOptions: {},
      runtimeEpoch: runtime.getRuntimeId()
    })
    const stage = started.worker.stage

    db.recordWorkerStage({ dispatchId: started.dispatch.id, stage })
    db.recordWorkerStage({ dispatchId: started.dispatch.id, stage: 'terminal_readying' })

    const states = db.readProjectFlowHistory({}).entries.filter((entry) => entry.kind === 'state')
    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({
      stage: 'terminal_readying',
      dispatchId: started.dispatch.id,
      taskId: task.id
    })
  })

  it('is empty, not an error, on a host that has no orchestration database yet', async () => {
    setup()
    vi.spyOn(runtime, 'getExistingOrchestrationDb').mockReturnValue(null)
    expect(await history()).toEqual({ entries: [], nextCursor: null })
  })
})
