import { afterEach, describe, expect, it } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session-record.test-fixture'
import { isOrcaSessionId } from '../../shared/orca-session-address'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../shared/structured-agent-session-projection'
import { OrchestrationDb } from './orchestration/db'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerProcessIncarnation
} from './structured-worker-identity'
import { buildOrchestrationChatContexts } from './runtime-orchestration-chat-projection'
import type { AgentSessionRecord } from '../../shared/agent-session-record'

const parentId = 'claude_parent_conversation'
const workerId = 'claude_worker_conversation'
const paneKey = (id: string) => structuredAgentSessionPaneKey(structuredAgentSessionTabId(id), id)

function record(sessionId: string): AgentSessionRecord {
  return {
    ...agentSessionRecordFixture(agentSessionLeaseFixture({ sessionId, claimStatus: 'released' })),
    options: { model: 'sonnet', effort: 'high' }
  }
}

describe('durable orchestration chat ownership', () => {
  let db: OrchestrationDb
  afterEach(() => db?.close())

  function setup() {
    if (!isOrcaSessionId(parentId)) {
      throw new Error('Invalid fixture session')
    }
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'Conversation tree',
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorOrcaSessionId: parentId
    })
    const task = db.createTask({
      runId: run.id,
      spec: 'Review the entry points',
      displayName: 'Entry review'
    })
    const credentialPaneKey = mintStructuredWorkerPaneKey(workerId)
    const dispatch = db.createDispatchContext({
      taskId: task.id,
      assigneeHandle: mintStructuredWorkerHandle(),
      assigneePaneKey: credentialPaneKey,
      processIncarnation: structuredWorkerProcessIncarnation(workerId),
      creator: { kind: 'session', orcaSessionId: parentId },
      maxDepth: 1
    })
    const records = [record(parentId), record(workerId)]
    const store = {
      listRecords: () => records,
      getRecord: (id: string) => records.find((row) => row.sessionId === id) ?? null,
      getVisibleSessionTabIndex: () => ({ present: true, sessionIds: [] })
    }
    return { run, dispatch, records, store, credentialPaneKey }
  }

  it('keeps a completed worker under its original closed parent after run unbinding and projection restart', () => {
    const { run, dispatch, store, credentialPaneKey } = setup()
    db.completeDispatch(dispatch.id)
    db.db
      .prepare('UPDATE dispatch_contexts SET completed_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00Z', dispatch.id)
    db.db.prepare('UPDATE runs SET coordinator_orca_session_id = NULL WHERE id = ?').run(run.id)
    for (let restart = 0; restart < 2; restart++) {
      const contexts = buildOrchestrationChatContexts(db, store)
      expect(Object.keys(contexts)).toEqual([paneKey(workerId)])
      expect(contexts[paneKey(workerId)]).toMatchObject({
        dispatchStatus: 'completed',
        parentPaneKey: paneKey(parentId),
        session: { sessionId: workerId, model: 'sonnet', effort: 'high' },
        parentSession: { sessionId: parentId }
      })
      expect(contexts[credentialPaneKey]).toBeUndefined()
    }
  })

  it('follows committed clear successors for both chats without changing dispatch identity', () => {
    const { records, store, dispatch } = setup()
    for (const row of records.slice()) {
      const successor = `${row.sessionId}_next`
      row.conversationCommand = {
        command: 'clear',
        state: 'completed',
        phase: 'committed',
        operationId: 'clear-operation',
        callerKey: 'caller',
        replacementSessionId: successor
      }
      records.push(record(successor))
    }
    const contexts = buildOrchestrationChatContexts(db, store)
    expect(Object.keys(contexts)).toEqual([paneKey(`${workerId}_next`)])
    expect(contexts[paneKey(`${workerId}_next`)]).toMatchObject({
      dispatchId: dispatch.id,
      parentPaneKey: paneKey(`${parentId}_next`)
    })
  })
})
