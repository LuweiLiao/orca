import type { GitHistoryItem, GitHistoryItemRef } from './git-history-types'

/** 'refs' walks an explicit set of refs; hosts that predate it reject the scope rather than widen it. */
export type GitGraphScope = 'head' | 'local' | 'all' | 'ref' | 'refs'

export const GIT_GRAPH_SCOPES: readonly GitGraphScope[] = ['head', 'local', 'all', 'ref', 'refs']

export const GIT_GRAPH_DEFAULT_LIMIT = 100
export const GIT_GRAPH_MAX_LIMIT = 200
/** Per namespace (heads, remotes, tags); newest by creator date win when capped. */
export const GIT_GRAPH_MAX_REFS_PER_NAMESPACE = 500
/** Deepest commit offset a snapshot pages to before reporting `truncated`. */
export const GIT_GRAPH_MAX_SCAN = 20_000
export const GIT_GRAPH_MAX_REF_LENGTH = 1024
/** Most refs one 'refs' request may select. */
export const GIT_GRAPH_MAX_SELECTED_REFS = 50

export type GitGraphOptions = {
  scope?: GitGraphScope
  ref?: string
  /** Selected refs for scope 'refs'; order-insensitive. */
  refs?: string[]
  limit?: number
  cursor?: string
}

export type GitGraphResult = {
  items: GitHistoryItem[]
  refs: GitHistoryItemRef[]
  headOid?: string
  currentRef?: GitHistoryItemRef
  scope: GitGraphScope
  /** Requested 'refs' entries that no longer resolve; the rest are still walked. */
  missingRefs?: string[]
  hasMore: boolean
  nextCursor?: string
  truncated: boolean
  isShallow: boolean
}

export type GitGraphExecutor = (
  args: string[],
  cwd: string,
  input?: { stdin?: string }
) => Promise<{ stdout: string; stderr?: string }>
