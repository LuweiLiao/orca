import {
  PROJECT_FLOW_KINDS,
  parseProjectFlowEndpoint,
  type ProjectFlowEndpoint,
  type ProjectFlowKind
} from './project-flow-event'

export const PROJECT_FLOW_HISTORY_RUNTIME_CAPABILITY =
  'orchestration.project-flow-history.v1' as const
export const PROJECT_FLOW_HISTORY_MAX_PAGE = 2_000

/** A flow kind, or `state`: a worker moved to another stage or state. */
export type ProjectFlowHistoryKind = ProjectFlowKind | 'state'

/** One thing that happened on a host, in the order the host recorded it. Ids and ends only. */
export type ProjectFlowHistoryEntry = {
  /** Rises by one per row on this host and never repeats, even after old rows are pruned. */
  seq: number
  /** Epoch milliseconds on the host's clock. */
  occurredAt: number
  kind: ProjectFlowHistoryKind
  from: ProjectFlowEndpoint | null
  to: ProjectFlowEndpoint | null
  outcome?: 'succeeded' | 'failed'
  runId?: string
  taskId?: string
  dispatchId?: string
  /** `state` rows only. */
  stage?: string
  workerState?: string
}

export type ProjectFlowHistoryPage = {
  entries: ProjectFlowHistoryEntry[]
  /** Pass back as `cursor` for the rows after this page; null when there are no more. */
  nextCursor: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseKind(value: unknown): ProjectFlowHistoryKind | null {
  return value === 'state' ? 'state' : (PROJECT_FLOW_KINDS.find((kind) => kind === value) ?? null)
}

function parseEntry(value: unknown): ProjectFlowHistoryEntry | null {
  if (!isRecord(value)) {
    return null
  }
  const { seq, occurredAt, outcome } = value
  const kind = parseKind(value.kind)
  if (
    typeof seq !== 'number' ||
    !Number.isInteger(seq) ||
    typeof occurredAt !== 'number' ||
    !Number.isFinite(occurredAt) ||
    !kind ||
    (outcome !== undefined && outcome !== 'succeeded' && outcome !== 'failed')
  ) {
    return null
  }
  const optional = {
    outcome,
    runId: text(value.runId),
    taskId: text(value.taskId),
    dispatchId: text(value.dispatchId),
    stage: text(value.stage),
    workerState: text(value.workerState)
  }
  return {
    seq,
    occurredAt,
    kind,
    from: parseProjectFlowEndpoint(value.from),
    to: parseProjectFlowEndpoint(value.to),
    ...Object.fromEntries(Object.entries(optional).filter(([, field]) => field !== undefined))
  }
}

/** A host's page is untrusted input: rows that are not exactly this shape are dropped. */
export function parseProjectFlowHistoryPage(value: unknown): ProjectFlowHistoryPage {
  if (!isRecord(value)) {
    return { entries: [], nextCursor: null }
  }
  const { entries, nextCursor } = value
  return {
    entries: Array.isArray(entries)
      ? entries.flatMap((row) => {
          const entry = parseEntry(row)
          return entry ? [entry] : []
        })
      : [],
    nextCursor: typeof nextCursor === 'string' && nextCursor.length > 0 ? nextCursor : null
  }
}
