import type {
  ProjectFlowEndpoint,
  ProjectFlowEvent
} from '../../../../../shared/project-flow-event'
import {
  parseProjectFlowHistoryPage,
  PROJECT_FLOW_HISTORY_MAX_PAGE,
  type ProjectFlowHistoryKind,
  type ProjectFlowHistoryPage
} from '../../../../../shared/project-flow-history'
import { OrchestrationError } from '../../orchestration-error'
import type { OrchestrationDb } from '../orchestration-db'

export const PROJECT_FLOW_LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const PROJECT_FLOW_LOG_MAX_ROWS = 50_000
const PROJECT_FLOW_LOG_PRUNE_EVERY_MS = 60 * 60 * 1000

export type ProjectFlowLogRow = {
  /** One named occurrence; a second row with the same id is not written. */
  eventId?: string
  kind: ProjectFlowHistoryKind
  from?: ProjectFlowEndpoint
  to?: ProjectFlowEndpoint
  outcome?: 'succeeded' | 'failed'
  runId?: string
  taskId?: string
  dispatchId?: string
  stage?: string
  workerState?: string
  occurredAt?: number
}

const json = (endpoint: ProjectFlowEndpoint | undefined): string | null =>
  endpoint ? JSON.stringify(endpoint) : null

function parseStoredEndpoint(stored: string | null): unknown {
  try {
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

/** The log row for an event the host published; ids come from what the host already knows. */
export function projectFlowLogRowOf(
  event: ProjectFlowEvent,
  ids: { runId?: string; taskId?: string; dispatchId?: string }
): ProjectFlowLogRow {
  return {
    eventId: event.id,
    kind: event.flow,
    from: event.from,
    to: event.to,
    ...(event.outcome ? { outcome: event.outcome } : {}),
    ...ids
  }
}

/**
 * Writes one row and says whether it did. A failure is logged and swallowed: history must never
 * undo the work it describes.
 */
export function appendProjectFlowLog(this: OrchestrationDb, row: ProjectFlowLogRow): boolean {
  try {
    pruneProjectFlowLogIfDue.call(this)
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO project_flow_log
           (event_id, occurred_at, kind, from_endpoint, to_endpoint, outcome, run_id, task_id,
            dispatch_id, stage, worker_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.eventId ?? null,
        row.occurredAt ?? Date.now(),
        row.kind,
        json(row.from),
        json(row.to),
        row.outcome ?? null,
        row.runId ?? null,
        row.taskId ?? null,
        row.dispatchId ?? null,
        row.stage ?? null,
        row.workerState ?? null
      )
    return result.changes > 0
  } catch (error) {
    console.warn('[orchestration] project flow log write failed:', error)
    return false
  }
}

const CURSOR = /^seq:(\d{1,15})$/

/** Rows after the cursor in seq order. The cursor is the last seq a page returned. */
export function readProjectFlowHistory(
  this: OrchestrationDb,
  params: { since?: number; until?: number; limit?: number; cursor?: string }
): ProjectFlowHistoryPage {
  pruneProjectFlowLogIfDue.call(this)
  const after =
    params.cursor === undefined ? 0 : Number(CURSOR.exec(params.cursor)?.[1] ?? Number.NaN)
  if (!Number.isSafeInteger(after)) {
    throw new OrchestrationError('invalid_argument', 'projectFlow.history cursor is not valid.')
  }
  const limit = Math.min(
    params.limit ?? PROJECT_FLOW_HISTORY_MAX_PAGE,
    PROJECT_FLOW_HISTORY_MAX_PAGE
  )
  // Why: one row past the page says whether there is more without a second count query.
  const rows = this.db
    .prepare(
      `SELECT seq, occurred_at, kind, from_endpoint, to_endpoint, outcome, run_id, task_id,
              dispatch_id, stage, worker_state
         FROM project_flow_log
        WHERE seq > ? AND occurred_at >= ? AND occurred_at < ?
        ORDER BY seq ASC
        LIMIT ?`
    )
    .all(
      after,
      params.since ?? Number.MIN_SAFE_INTEGER,
      params.until ?? Number.MAX_SAFE_INTEGER,
      limit + 1
    )
  const shown = rows.slice(0, limit).map(toWireRow)
  // Why: the same parser a viewer uses, so a stored row that no longer fits is dropped, not sent.
  const { entries } = parseProjectFlowHistoryPage({ entries: shown })
  const last = shown.at(-1)
  return {
    entries,
    nextCursor: rows.length > limit && last ? `seq:${String(last.seq)}` : null
  }
}

/** Every column of the SELECT above, which is all `toWireRow` reads. */
type StoredRow = {
  seq: number
  occurred_at: number
  kind: string
  from_endpoint: string | null
  to_endpoint: string | null
  outcome: string | null
  run_id: string | null
  task_id: string | null
  dispatch_id: string | null
  stage: string | null
  worker_state: string | null
}

function toWireRow(row: unknown): Record<string, unknown> & { seq: number } {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the SELECT in readProjectFlowHistory names exactly these columns.
  const stored = row as StoredRow
  return {
    seq: stored.seq,
    occurredAt: stored.occurred_at,
    kind: stored.kind,
    from: parseStoredEndpoint(stored.from_endpoint),
    to: parseStoredEndpoint(stored.to_endpoint),
    outcome: stored.outcome ?? undefined,
    runId: stored.run_id ?? undefined,
    taskId: stored.task_id ?? undefined,
    dispatchId: stored.dispatch_id ?? undefined,
    stage: stored.stage ?? undefined,
    workerState: stored.worker_state ?? undefined
  }
}

/**
 * Drops rows older than the age limit, then the oldest past the row limit. `now` is injectable so
 * a test needs no clock.
 */
export function pruneProjectFlowLog(
  this: OrchestrationDb,
  options: { now?: number; maxAgeMs?: number; maxRows?: number } = {}
): number {
  const now = options.now ?? Date.now()
  const aged = this.db
    .prepare('DELETE FROM project_flow_log WHERE occurred_at < ?')
    .run(now - (options.maxAgeMs ?? PROJECT_FLOW_LOG_MAX_AGE_MS)).changes
  const maxRows = options.maxRows ?? PROJECT_FLOW_LOG_MAX_ROWS
  const oldestKept = this.db
    .prepare('SELECT seq FROM project_flow_log ORDER BY seq DESC LIMIT 1 OFFSET ?')
    .get(maxRows - 1)
  const keepFrom = oldestKept ? Number(Object.values(oldestKept)[0]) : null
  const surplus =
    keepFrom === null
      ? 0
      : this.db.prepare('DELETE FROM project_flow_log WHERE seq < ?').run(keepFrom).changes
  return Number(aged) + Number(surplus)
}

/**
 * Prunes at open and then whenever a write or a read finds the last prune over an hour old. No
 * timer: a timer inside the database would never let a test with fake timers finish.
 */
export function pruneProjectFlowLogIfDue(this: OrchestrationDb, now = Date.now()): void {
  if (
    this.projectFlowPrunedAt !== undefined &&
    now - this.projectFlowPrunedAt < PROJECT_FLOW_LOG_PRUNE_EVERY_MS
  ) {
    return
  }
  this.projectFlowPrunedAt = now
  try {
    pruneProjectFlowLog.call(this, { now })
  } catch (error) {
    console.warn('[orchestration] project flow log prune failed:', error)
  }
}

export type ProjectFlowLogStoreMethods = {
  appendProjectFlowLog: typeof appendProjectFlowLog
  readProjectFlowHistory: typeof readProjectFlowHistory
  pruneProjectFlowLog: typeof pruneProjectFlowLog
}

export function attachProjectFlowLogStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    appendProjectFlowLog,
    readProjectFlowHistory,
    pruneProjectFlowLog
  })
}
