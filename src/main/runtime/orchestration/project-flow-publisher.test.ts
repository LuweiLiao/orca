import { afterEach, describe, expect, it, vi } from 'vitest'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerProcessIncarnation
} from '../structured-worker-identity'
import { OrchestrationDb } from './db'
import { delegateFlowEvent, mergeFlowEvent } from './project-flow-events'
import { publishProjectFlow } from './project-flow-publisher'

const open: OrchestrationDb[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const db of open.splice(0)) {
    db.close()
  }
})

function sink(db: OrchestrationDb | null) {
  const notify = vi.fn()
  return { notify, sink: { notifyProjectFlow: notify, getExistingOrchestrationDb: () => db } }
}

function memoryDb(): OrchestrationDb {
  const db = new OrchestrationDb(':memory:')
  open.push(db)
  return db
}

describe('publishProjectFlow', () => {
  it('writes one row and sends once for an event, however often it is published', () => {
    const db = memoryDb()
    const { notify, sink: target } = sink(db)
    publishProjectFlow(target, delegateFlowEvent('d1'))
    publishProjectFlow(target, delegateFlowEvent('d1'))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(db.readProjectFlowHistory({}).entries).toHaveLength(1)
    expect(db.readProjectFlowHistory({}).entries[0]).toMatchObject({
      kind: 'delegate',
      dispatchId: 'd1'
    })
  })

  it('writes a merge as a merge', () => {
    const db = memoryDb()
    const { sink: target } = sink(db)
    publishProjectFlow(target, mergeFlowEvent('repo', 7))
    expect(db.readProjectFlowHistory({}).entries.map((entry) => entry.kind)).toEqual(['merge'])
  })

  it('still sends when the log cannot be written or there is no database', () => {
    const broken = memoryDb()
    broken.db.exec('DROP TABLE project_flow_log')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const withBroken = sink(broken)
    publishProjectFlow(withBroken.sink, delegateFlowEvent('d1'))
    const withNone = sink(null)
    publishProjectFlow(withNone.sink, delegateFlowEvent('d2'))
    expect(withBroken.notify).toHaveBeenCalledTimes(1)
    expect(withNone.notify).toHaveBeenCalledTimes(1)
  })

  it('names a dispatch by its chats, so a released worker can still be placed', () => {
    const db = memoryDb()
    const coordinator = testOrcaSessionId('5c7e9b1d-3f6a-4c8e-9d1f-4a6c8e0b2d36')
    const worker = testOrcaSessionId('6d8f0c2e-4a7b-4d9f-8e2a-5b7d9f1c3e47')
    const run = db.createRun({
      objective: 'flow',
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorOrcaSessionId: coordinator
    })
    const task = db.createTask({ runId: run.id, spec: 'work' })
    const dispatch = db.createDispatchContext({
      taskId: task.id,
      assigneeHandle: mintStructuredWorkerHandle(),
      assigneePaneKey: mintStructuredWorkerPaneKey(worker),
      processIncarnation: structuredWorkerProcessIncarnation(worker),
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    const { notify, sink: target } = sink(db)
    publishProjectFlow(target, delegateFlowEvent(dispatch.id))
    const ends = {
      from: { kind: 'coordinator', dispatchId: dispatch.id, sessionId: coordinator },
      to: { kind: 'worker', dispatchId: dispatch.id, sessionId: worker }
    }
    expect(notify.mock.calls[0]?.[0]).toMatchObject(ends)
    expect(db.readProjectFlowHistory({}).entries[0]).toMatchObject(ends)
  })

  it('records the run the caller knew when the event names no dispatch', () => {
    const db = memoryDb()
    const { sink: target } = sink(db)
    publishProjectFlow(target, mergeFlowEvent('repo', 9), { runId: 'run1' })
    expect(db.readProjectFlowHistory({}).entries[0]).toMatchObject({ runId: 'run1' })
  })
})
