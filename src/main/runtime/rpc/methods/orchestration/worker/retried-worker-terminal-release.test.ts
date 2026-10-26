import { afterEach, expect, it, vi } from 'vitest'
import { WORKER_RETRY_PRIOR_ATTEMPT_LIVE_CODE } from '../../../../../../shared/agent-delegation-grant'
import type { AgentSessionRecord } from '../../../../../../shared/agent-session-record'
import { agentSessionRecordFixture } from '../../../../../native-chat/agent-session-record-test-fixture'
import type { StructuredAgentSessionHost } from '../../../../../native-chat/agent-session-wire/structured-agent-session-host'
import { setStructuredAgentSessionHost } from '../../../../../native-chat/agent-session-wire/structured-agent-session-registry'
import { OrchestrationDb } from '../../../../orchestration/db'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import { releaseRetriedWorkerTerminal } from './retried-worker-terminal-release'

const WORKER_SESSION = 'session_worker_root'

// Only the Dispatch-to-worker lookup is stubbed; liveness reads the real record store.
vi.mock('../../orchestration-structured-worker-lifecycle', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveStructuredWorkerForDispatch: () => ({
    handle: 'structworker_1',
    sessionId: WORKER_SESSION
  })
}))

const databases: OrchestrationDb[] = []
afterEach(() => {
  databases.splice(0).forEach((db) => db.close())
  setStructuredAgentSessionHost(null)
})

const LIVE_OWNER = { hostId: 'local', pid: 4242, processStartTimeMs: 1, spawnToken: 'spawn-1' }

function live(sessionId: string): AgentSessionRecord {
  const record = agentSessionRecordFixture({ sessionId })
  return {
    ...record,
    lease: { ...record.lease, runtimeFence: 2, claimStatus: 'live', ownerProcess: LIVE_OWNER }
  }
}

function exited(sessionId: string, clearedInto?: string): AgentSessionRecord {
  const record = agentSessionRecordFixture({ sessionId })
  return {
    ...record,
    lease: {
      ...record.lease,
      runtimeFence: 2,
      deathEvidence: { kind: 'exit-observed', detail: 'exited', observedAt: 1 }
    },
    ...(clearedInto
      ? {
          conversationCommand: {
            command: 'clear',
            state: 'completed',
            replacementSessionId: clearedInto,
            operationId: 'op-clear',
            callerKey: 'desktop',
            phase: 'committed'
          }
        }
      : {})
  }
}

/** The host as a failed start's teardown left it: `hasSession` for a close that threw. */
function host(records: AgentSessionRecord[], open: string[]): void {
  const byId = new Map(records.map((record) => [record.sessionId, record]))
  const stub = {
    deps: {
      store: { getRecord: (id: string) => byId.get(id) ?? null, listRecords: () => records }
    },
    hasSession: (id: string) => open.includes(id)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: liveness reads only the record store and hasSession.
  setStructuredAgentSessionHost(stub as unknown as StructuredAgentSessionHost)
}

/** A structured worker's failed start. */
function failedStructuredAttempt() {
  const db = new OrchestrationDb(':memory:')
  databases.push(db)
  const task = db.createTask({ runId: 'run_legacy_local', spec: 'structured' })
  const { dispatch } = db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    taskId: task.id,
    startOptions: {}
  })
  db.failWorkerStart(dispatch.id, 'dispatch_input', 'close threw')
  return { db, start: { retryOf: dispatch.id, taskId: task.id } }
}

const refused = { code: WORKER_RETRY_PRIOR_ATTEMPT_LIVE_CODE }

it('refuses the retry while a close that threw left the session running', async () => {
  host([live(WORKER_SESSION)], [WORKER_SESSION])
  const { db, start } = failedStructuredAttempt()
  await expect(
    releaseRetriedWorkerTerminal(new OrcaRuntimeService(), db, start)
  ).rejects.toMatchObject({
    ...refused,
    data: expect.objectContaining({ dispatchId: start.retryOf })
  })
})

it('refuses the retry when the root exited but its /clear successor runs', async () => {
  host(
    [exited(WORKER_SESSION, 'session_worker_next'), live('session_worker_next')],
    ['session_worker_next']
  )
  const { db, start } = failedStructuredAttempt()
  await expect(
    releaseRetriedWorkerTerminal(new OrcaRuntimeService(), db, start)
  ).rejects.toMatchObject(refused)
})

it('refuses the retry when a released session left no proof of exit', async () => {
  host(
    [
      agentSessionRecordFixture({
        sessionId: WORKER_SESSION,
        lease: { ...live(WORKER_SESSION).lease, claimStatus: 'released', ownerProcess: null }
      })
    ],
    []
  )
  const { db, start } = failedStructuredAttempt()
  await expect(
    releaseRetriedWorkerTerminal(new OrcaRuntimeService(), db, start)
  ).rejects.toMatchObject(refused)
})

it('admits the retry once the attempt’s session has exited', async () => {
  host([exited(WORKER_SESSION)], [])
  const { db, start } = failedStructuredAttempt()
  await expect(
    releaseRetriedWorkerTerminal(new OrcaRuntimeService(), db, start)
  ).resolves.toBeUndefined()
})
