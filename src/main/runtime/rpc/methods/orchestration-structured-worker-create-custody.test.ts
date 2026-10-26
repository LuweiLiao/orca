import { afterEach, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import { OrchestrationDb } from '../../orchestration/db'
import { OrcaRuntimeService } from '../../orca-runtime'
import { structuredWorkerIdentities } from '../../structured-worker-identity'
import { resolveStructuredWorkerForDispatch } from './orchestration-structured-worker-lifecycle'
import { releaseRetriedWorkerTerminal } from './orchestration/worker/retried-worker-terminal-release'
import { createStructuredWorkerSessionForWorktree } from './orchestration/worker/worker-topology'

const create = vi.fn()
vi.mock('./structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: (...args: unknown[]) => create(...args)
}))

let db: OrchestrationDb | undefined
afterEach(() => {
  db?.close()
  setStructuredAgentSessionHost(null)
  structuredWorkerIdentities.clear()
  vi.restoreAllMocks()
  create.mockReset()
})

function fixture() {
  const database = (db = new OrchestrationDb(':memory:'))
  const task = database.createTask({ runId: 'run_legacy_local', spec: 'Review' })
  const { dispatch } = database.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: 3,
    taskId: task.id,
    startOptions: { agent: 'claude' }
  })
  const runtime = new OrcaRuntimeService()
  vi.spyOn(runtime, 'ensureStructuredAgentSessionHost').mockResolvedValue()
  const close = vi.fn(async () => {
    throw new Error('Provider close refused')
  })
  const host = {
    hasSession: () => true,
    close,
    setSessionTabVisibility: async () => {},
    deps: {
      store: {
        listRecords: () => [],
        getRecord: () => ({
          agent: 'claude',
          location: { executionHostId: 'local', wslDistro: null },
          lease: { runtimeKind: 'native', claimStatus: 'live', runtimeFence: 2 }
        })
      }
    },
    history: async () => ({ ok: true, page: { items: [], hasOlder: false } })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test supplies only the provider host boundary used by creation and release.
  setStructuredAgentSessionHost(host as unknown as StructuredAgentSessionHost)
  const start = () =>
    createStructuredWorkerSessionForWorktree({
      runtime,
      db: database,
      worktreeId: 'wt_1',
      agent: 'claude',
      dispatchId: dispatch.id,
      effects: []
    })
  return { db: database, runtime, dispatch, task, start, close }
}

it.each(['unknown', 'throw'] as const)(
  'retains the identity of a possibly created session after a %s outcome and refused close',
  async (outcome) => {
    const f = fixture()
    create.mockImplementation(async () => {
      if (outcome === 'throw') {
        throw new Error('Tab publication failed after attach')
      }
      return {
        ok: false,
        refusal: { code: 'agent_session_operation_unknown', message: 'Tab publication unknown' }
      }
    })
    await expect(f.start()).rejects.toThrow()
    expect(f.close).toHaveBeenCalledOnce()
    f.db.failWorkerStart(f.dispatch.id, 'terminal_create', 'Tab publication failed')

    const resource = f.db.getWorkerTerminalResourceByOwner(f.dispatch.id)
    expect(resource).toMatchObject({ ownership_state: 'owned', release_state: 'not_requested' })
    structuredWorkerIdentities.clear()
    const identity = resolveStructuredWorkerForDispatch(f.db, f.dispatch.id)
    expect(identity).toMatchObject({ handle: resource?.terminal_handle })
    expect(f.db.getDispatchContextById(f.dispatch.id)).toMatchObject({
      assignee_orca_session_id: identity?.sessionId,
      capability_revoked_at: expect.any(String)
    })
    await expect(
      releaseRetriedWorkerTerminal(f.runtime, f.db, {
        retryOf: f.dispatch.id,
        taskId: f.task.id
      })
    ).rejects.toMatchObject({ code: 'worker_retry_prior_attempt_live' })
    expect(create).toHaveBeenCalledOnce()
  }
)

it('records no agent when the create was definitively refused before attach', async () => {
  const f = fixture()
  create.mockResolvedValue({
    ok: false,
    refusal: { code: 'structured_agent_session_unsupported', message: 'Unsupported' }
  })
  await expect(f.start()).rejects.toThrow('Unsupported')
  expect(f.db.getWorkerTerminalResourceByOwner(f.dispatch.id)).toBeUndefined()
  expect(f.close).not.toHaveBeenCalled()
})
