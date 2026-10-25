import { parseGitHistoryLog } from './git-history-log-parser'
import type { GitHistoryItem } from './git-history-types'
import {
  GIT_GRAPH_CURSOR_EXPIRED_CODE,
  GIT_GRAPH_CURSOR_INVALID_CODE,
  GIT_GRAPH_REF_NOT_FOUND_CODE,
  GIT_GRAPH_SNAPSHOT_CHANGED_CODE
} from './git-graph-errors'
import { captureGitGraphSnapshot, gitGraphErrorText } from './git-graph-snapshot-capture'
import {
  decodeGitGraphCursor,
  encodeGitGraphCursor,
  type GitGraphSnapshot,
  type GitGraphSnapshotStore
} from './git-graph-snapshot-store'
import {
  GIT_GRAPH_DEFAULT_LIMIT,
  GIT_GRAPH_MAX_LIMIT,
  GIT_GRAPH_MAX_REF_LENGTH,
  GIT_GRAPH_MAX_SCAN,
  GIT_GRAPH_SCOPES,
  type GitGraphExecutor,
  type GitGraphOptions,
  type GitGraphResult,
  type GitGraphScope
} from './git-graph-types'

// Why blank decoration lines: keeps the shared parser's field layout while labels come from
// the pinned ref snapshot, so refs that move after page one cannot relabel later pages.
const GIT_GRAPH_COMMIT_FORMAT = '%H%n%aN%n%aE%n%at%n%ct%n%P%n%n%n%B'

const STALE_OBJECT_PATTERN = /bad object|bad revision|unknown revision|not a valid object/i

export type GitGraphBinding = {
  /** Host-local identity of the worktree; cursors from any other key are rejected. */
  repositoryKey: string
  snapshots: GitGraphSnapshotStore
}

type SnapshotPage = { token?: string; offset: number; boundary?: string; limit: number }

function clampGraphLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return GIT_GRAPH_DEFAULT_LIMIT
  }
  return Math.min(GIT_GRAPH_MAX_LIMIT, Math.max(1, Math.trunc(limit)))
}

function normalizeScope(scope: GitGraphScope | undefined): GitGraphScope {
  const normalized = scope ?? 'head'
  if (!GIT_GRAPH_SCOPES.includes(normalized)) {
    throw new Error(`Unsupported Git graph scope: ${String(scope)}`)
  }
  return normalized
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

function normalizeScopeRef(scope: GitGraphScope, ref: string | undefined): string | undefined {
  if (scope !== 'ref') {
    return undefined
  }
  const normalized = ref?.trim()
  // Why: the ref reaches rev-parse argv; options and control characters are never ref names.
  if (
    !normalized ||
    normalized.startsWith('-') ||
    normalized.length > GIT_GRAPH_MAX_REF_LENGTH ||
    hasControlCharacter(normalized)
  ) {
    throw new Error(GIT_GRAPH_REF_NOT_FOUND_CODE)
  }
  return normalized
}

async function readSnapshotRows(
  git: GitGraphExecutor,
  cwd: string,
  snapshot: GitGraphSnapshot,
  skip: number,
  count: number,
  isContinuation: boolean
): Promise<GitHistoryItem[]> {
  try {
    // Why stdin: pinned tips can number in the hundreds; argv length limits differ per OS.
    const { stdout } = await git(
      [
        'log',
        '--no-show-signature',
        '--no-color',
        `--format=${GIT_GRAPH_COMMIT_FORMAT}`,
        '-z',
        '--topo-order',
        `--skip=${skip}`,
        `-n${count}`,
        '--stdin',
        '--'
      ],
      cwd,
      { stdin: `${snapshot.tips.join('\n')}\n` }
    )
    return parseGitHistoryLog(stdout)
  } catch (error) {
    if (isContinuation && STALE_OBJECT_PATTERN.test(gitGraphErrorText(error))) {
      throw new Error(GIT_GRAPH_SNAPSHOT_CHANGED_CODE)
    }
    throw error
  }
}

async function readSnapshotPage(
  git: GitGraphExecutor,
  cwd: string,
  snapshot: GitGraphSnapshot,
  page: SnapshotPage,
  snapshots: GitGraphSnapshotStore
): Promise<GitGraphResult> {
  const pageLimit = Math.min(page.limit, GIT_GRAPH_MAX_SCAN - page.offset)
  const isContinuation = page.offset > 0
  let rows: GitHistoryItem[] = []
  if (snapshot.tips.length > 0 && pageLimit > 0) {
    // Why one row of overlap: the previous page's last commit must still sit at offset - 1.
    rows = await readSnapshotRows(
      git,
      cwd,
      snapshot,
      isContinuation ? page.offset - 1 : 0,
      pageLimit + (isContinuation ? 2 : 1),
      isContinuation
    )
    if (isContinuation) {
      const anchor = rows.shift()
      if (!anchor || !page.boundary || !anchor.id.toLowerCase().startsWith(page.boundary)) {
        throw new Error(GIT_GRAPH_SNAPSHOT_CHANGED_CODE)
      }
    }
  }

  const items = rows.slice(0, pageLimit).map((item) => ({
    ...item,
    references: snapshot.refsByOid.get(item.id) ?? []
  }))
  const hasRowsBeyondPage = rows.length > pageLimit
  const nextOffset = page.offset + items.length
  const scanCapped = hasRowsBeyondPage && nextOffset >= GIT_GRAPH_MAX_SCAN
  const hasMore = hasRowsBeyondPage && !scanCapped
  const lastItem = items.at(-1)
  let nextCursor: string | undefined
  if (hasMore && lastItem) {
    // Why lazily: a graph that fits one page never occupies a snapshot slot.
    const token = page.token ?? snapshots.create(snapshot)
    nextCursor = encodeGitGraphCursor(token, nextOffset, lastItem.id)
  }

  return {
    items,
    refs: [...snapshot.refs],
    ...(snapshot.headOid ? { headOid: snapshot.headOid } : {}),
    ...(snapshot.currentRef ? { currentRef: snapshot.currentRef } : {}),
    scope: snapshot.scope,
    hasMore,
    ...(nextCursor ? { nextCursor } : {}),
    truncated: snapshot.refsTruncated || scanCapped,
    isShallow: snapshot.isShallow
  }
}

/**
 * Multi-ref commit graph pages over a pinned tip snapshot.
 *
 * Page one captures HEAD plus the scope's ref tips; continuation cursors replay that exact tip
 * set, so later ref moves, fetches and commits never duplicate or drop rows within one walk.
 */
export async function loadGitGraphFromExecutor(
  git: GitGraphExecutor,
  cwd: string,
  options: GitGraphOptions,
  binding: GitGraphBinding
): Promise<GitGraphResult> {
  const limit = clampGraphLimit(options.limit)
  const scope = normalizeScope(options.scope)
  if (options.cursor === undefined) {
    const ref = normalizeScopeRef(scope, options.ref)
    const snapshot = await captureGitGraphSnapshot(git, cwd, scope, ref, binding.repositoryKey)
    return readSnapshotPage(git, cwd, snapshot, { offset: 0, limit }, binding.snapshots)
  }

  const cursor = decodeGitGraphCursor(options.cursor)
  const snapshot = binding.snapshots.read(cursor.token)
  if (!snapshot) {
    throw new Error(GIT_GRAPH_CURSOR_EXPIRED_CODE)
  }
  const ref = scope === 'ref' ? options.ref?.trim() : undefined
  if (
    snapshot.repositoryKey !== binding.repositoryKey ||
    snapshot.scope !== scope ||
    snapshot.ref !== ref
  ) {
    throw new Error(GIT_GRAPH_CURSOR_INVALID_CODE)
  }
  return readSnapshotPage(
    git,
    cwd,
    snapshot,
    { token: cursor.token, offset: cursor.offset, boundary: cursor.boundary, limit },
    binding.snapshots
  )
}
