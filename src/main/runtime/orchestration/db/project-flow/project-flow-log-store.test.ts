import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

const open: OrchestrationDb[] = []
const dirs: string[] = []

function memoryDb(): OrchestrationDb {
  const db = new OrchestrationDb(':memory:')
  open.push(db)
  return db
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const db of open.splice(0)) {
    db.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const count = (db: OrchestrationDb): number =>
  Number(Object.values(db.db.prepare('SELECT COUNT(*) FROM project_flow_log').get() ?? {})[0])

describe('project flow log schema', () => {
  it('is created on an empty database', () => {
    const db = memoryDb()
    expect(db.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(count(db)).toBe(0)
  })

  it('is added to a database from before it existed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'project-flow-log-'))
    dirs.push(dir)
    const file = path.join(dir, 'orchestration.db')
    const first = new OrchestrationDb(file)
    first.db.exec('DROP TABLE project_flow_log')
    first.db.pragma('user_version = 44')
    first.close()
    const upgraded = new OrchestrationDb(file)
    open.push(upgraded)
    expect(upgraded.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(upgraded.appendProjectFlowLog({ eventId: 'a', kind: 'delegate' })).toBe(true)
  })
})

describe('appendProjectFlowLog', () => {
  it('writes one row per named occurrence', () => {
    const db = memoryDb()
    expect(db.appendProjectFlowLog({ eventId: 'd1:dispatched', kind: 'delegate' })).toBe(true)
    expect(db.appendProjectFlowLog({ eventId: 'd1:dispatched', kind: 'delegate' })).toBe(false)
    expect(db.appendProjectFlowLog({ eventId: 'd1:completed', kind: 'report' })).toBe(true)
    expect(count(db)).toBe(2)
  })

  it('writes every state change, which has no named occurrence', () => {
    const db = memoryDb()
    db.appendProjectFlowLog({ kind: 'state', stage: 'starting', dispatchId: 'd1' })
    db.appendProjectFlowLog({ kind: 'state', stage: 'starting', dispatchId: 'd1' })
    expect(count(db)).toBe(2)
  })

  it('logs a failed write and does not throw', () => {
    const db = memoryDb()
    db.db.exec('DROP TABLE project_flow_log')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(db.appendProjectFlowLog({ eventId: 'x', kind: 'delegate' })).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('keeps ids and ends but nothing else a flight could carry', () => {
    const db = memoryDb()
    db.appendProjectFlowLog({
      eventId: 'm1',
      kind: 'handoff',
      from: { kind: 'session', sessionId: 's1' },
      to: { kind: 'pane', paneKey: 'p1' },
      runId: 'run1'
    })
    const columns = db.db
      .prepare('PRAGMA table_info(project_flow_log)')
      .all()
      .flatMap((column) => Object.entries(column).filter(([key]) => key === 'name'))
      .map(([, name]) => name)
    expect(columns).not.toContain('body')
    expect(columns).not.toContain('payload')
    expect(db.readProjectFlowHistory({}).entries[0]).toMatchObject({
      kind: 'handoff',
      from: { kind: 'session', sessionId: 's1' },
      to: { kind: 'pane', paneKey: 'p1' },
      runId: 'run1'
    })
  })
})

describe('pruneProjectFlowLog', () => {
  it('drops rows older than the age limit', () => {
    const db = memoryDb()
    db.appendProjectFlowLog({ eventId: 'old', kind: 'delegate', occurredAt: 1_000 })
    db.appendProjectFlowLog({ eventId: 'new', kind: 'delegate', occurredAt: 9_000 })
    expect(db.pruneProjectFlowLog({ now: 10_000, maxAgeMs: 5_000 })).toBe(1)
    expect(db.readProjectFlowHistory({}).entries.map((entry) => entry.occurredAt)).toEqual([9_000])
  })

  it('keeps the newest rows up to the row limit, and seq never repeats afterwards', () => {
    const db = memoryDb()
    for (let index = 1; index <= 5; index += 1) {
      db.appendProjectFlowLog({ eventId: `e${index}`, kind: 'delegate', occurredAt: index })
    }
    expect(db.pruneProjectFlowLog({ now: 10, maxAgeMs: 1_000, maxRows: 3 })).toBe(2)
    expect(db.readProjectFlowHistory({}).entries.map((entry) => entry.seq)).toEqual([3, 4, 5])
    db.appendProjectFlowLog({ eventId: 'e6', kind: 'delegate', occurredAt: 6 })
    expect(db.readProjectFlowHistory({}).entries.at(-1)?.seq).toBe(6)
  })

  it('leaves a log under both limits alone', () => {
    const db = memoryDb()
    db.appendProjectFlowLog({ eventId: 'a', kind: 'delegate', occurredAt: 5 })
    expect(db.pruneProjectFlowLog({ now: 10, maxAgeMs: 1_000, maxRows: 3 })).toBe(0)
  })
})

describe('pruneProjectFlowLogIfDue', () => {
  it('prunes at open, then at most once an hour, with no timer', () => {
    vi.useFakeTimers()
    try {
      const db = memoryDb()
      expect(vi.getTimerCount()).toBe(0)
      const stale = Date.now() - 31 * 24 * 60 * 60 * 1000
      db.appendProjectFlowLog({ eventId: 'stale', kind: 'delegate', occurredAt: stale })
      expect(db.readProjectFlowHistory({}).entries).toHaveLength(1)
      vi.setSystemTime(Date.now() + 61 * 60 * 1000)
      db.appendProjectFlowLog({ eventId: 'fresh', kind: 'delegate' })
      expect(db.readProjectFlowHistory({}).entries.map((entry) => entry.seq)).toEqual([2])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('readProjectFlowHistory', () => {
  function filled(rows: number): OrchestrationDb {
    const db = memoryDb()
    for (let index = 1; index <= rows; index += 1) {
      db.appendProjectFlowLog({ eventId: `e${index}`, kind: 'delegate', occurredAt: index * 10 })
    }
    return db
  }

  it('pages in seq order without losing or repeating a row', () => {
    const db = filled(7)
    const seen: number[] = []
    let cursor: string | undefined
    for (;;) {
      const page = db.readProjectFlowHistory({ limit: 3, ...(cursor ? { cursor } : {}) })
      seen.push(...page.entries.map((entry) => entry.seq))
      if (!page.nextCursor) {
        break
      }
      cursor = page.nextCursor
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('ends exactly at the last row instead of offering an empty page', () => {
    expect(filled(3).readProjectFlowHistory({ limit: 3 }).nextCursor).toBeNull()
  })

  it('keeps the cursor valid while rows are added or pruned between pages', () => {
    const db = filled(4)
    const first = db.readProjectFlowHistory({ limit: 2 })
    db.appendProjectFlowLog({ eventId: 'later', kind: 'report', occurredAt: 500 })
    db.pruneProjectFlowLog({ now: 100, maxAgeMs: 1_000, maxRows: 3 })
    const rest = db.readProjectFlowHistory({ cursor: first.nextCursor ?? undefined })
    expect(rest.entries.map((entry) => entry.seq)).toEqual([3, 4, 5])
  })

  it('limits by time range and caps a page at 2000', () => {
    const db = filled(5)
    expect(
      db.readProjectFlowHistory({ since: 20, until: 40 }).entries.map((entry) => entry.occurredAt)
    ).toEqual([20, 30])
    expect(db.readProjectFlowHistory({ limit: 999_999 }).entries).toHaveLength(5)
  })

  it('refuses a cursor it did not give out', () => {
    expect(() => memoryDb().readProjectFlowHistory({ cursor: 'garbage' })).toThrow(/cursor/)
  })
})
