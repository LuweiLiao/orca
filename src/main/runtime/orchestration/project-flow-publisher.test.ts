import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('records the run the caller knew when the event names no dispatch', () => {
    const db = memoryDb()
    const { sink: target } = sink(db)
    publishProjectFlow(target, mergeFlowEvent('repo', 9), { runId: 'run1' })
    expect(db.readProjectFlowHistory({}).entries[0]).toMatchObject({ runId: 'run1' })
  })
})
