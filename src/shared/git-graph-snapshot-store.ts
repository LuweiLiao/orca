import { randomUUID } from 'node:crypto'
import type { GitHistoryItemRef } from './git-history-types'
import { GIT_GRAPH_CURSOR_INVALID_CODE } from './git-graph-errors'
import { GIT_GRAPH_MAX_SCAN, type GitGraphScope } from './git-graph-types'

export const GIT_GRAPH_SNAPSHOT_TTL_MS = 10 * 60_000
export const GIT_GRAPH_SNAPSHOT_MAX_ENTRIES = 32

const CURSOR_VERSION = 'gg1'
const CURSOR_BOUNDARY_LENGTH = 16
const CURSOR_PATTERN = /^gg1\.([0-9a-f]{32})\.([1-9][0-9]{0,8})\.([0-9a-f]{16})$/

/** Everything later pages must reuse so refs moving between pages cannot shift the walk. */
export type GitGraphSnapshot = {
  repositoryKey: string
  scope: GitGraphScope
  ref?: string
  tips: readonly string[]
  refs: readonly GitHistoryItemRef[]
  refsByOid: ReadonlyMap<string, GitHistoryItemRef[]>
  headOid?: string
  currentRef?: GitHistoryItemRef
  isShallow: boolean
  refsTruncated: boolean
}

export type GitGraphCursor = {
  token: string
  /** Rows already delivered from this snapshot. */
  offset: number
  /** OID prefix of row `offset - 1`; proves the walk still lines up before serving the page. */
  boundary: string
}

export function encodeGitGraphCursor(token: string, offset: number, lastOid: string): string {
  return `${CURSOR_VERSION}.${token}.${offset}.${lastOid.slice(0, CURSOR_BOUNDARY_LENGTH).toLowerCase()}`
}

export function decodeGitGraphCursor(cursor: string): GitGraphCursor {
  const match = CURSOR_PATTERN.exec(cursor)
  const offset = match ? Number(match[2]) : Number.NaN
  if (!match || !Number.isSafeInteger(offset) || offset > GIT_GRAPH_MAX_SCAN) {
    throw new Error(GIT_GRAPH_CURSOR_INVALID_CODE)
  }
  return { token: match[1], offset, boundary: match[3] }
}

type SnapshotEntry = { snapshot: GitGraphSnapshot; expiresAt: number }

/** Host-memory snapshots keyed by random tokens; idle TTL plus LRU keep retention bounded. */
export class GitGraphSnapshotStore {
  private readonly entries = new Map<string, SnapshotEntry>()

  constructor(
    private readonly maxEntries = GIT_GRAPH_SNAPSHOT_MAX_ENTRIES,
    private readonly ttlMs = GIT_GRAPH_SNAPSHOT_TTL_MS
  ) {}

  create(snapshot: GitGraphSnapshot): string {
    this.pruneExpired()
    const token = randomUUID().replaceAll('-', '')
    this.entries.set(token, { snapshot, expiresAt: Date.now() + this.ttlMs })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.entries.delete(oldest)
    }
    return token
  }

  read(token: string): GitGraphSnapshot | undefined {
    const entry = this.entries.get(token)
    if (!entry) {
      return undefined
    }
    this.entries.delete(token)
    if (entry.expiresAt <= Date.now()) {
      return undefined
    }
    // Why re-insert: Map order is the LRU order, so a paging reader stays resident.
    this.entries.set(token, { snapshot: entry.snapshot, expiresAt: Date.now() + this.ttlMs })
    return entry.snapshot
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(token)
      }
    }
  }
}
