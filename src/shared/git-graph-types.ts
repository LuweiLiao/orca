import type { GitHistoryItem, GitHistoryItemRef } from './git-history-types'

export type GitGraphScope = 'head' | 'local' | 'all' | 'ref'

export const GIT_GRAPH_SCOPES: readonly GitGraphScope[] = ['head', 'local', 'all', 'ref']

export const GIT_GRAPH_DEFAULT_LIMIT = 100
export const GIT_GRAPH_MAX_LIMIT = 200
/** Per namespace (heads, remotes, tags); newest by creator date win when capped. */
export const GIT_GRAPH_MAX_REFS_PER_NAMESPACE = 500
/** Deepest commit offset a snapshot pages to before reporting `truncated`. */
export const GIT_GRAPH_MAX_SCAN = 20_000
export const GIT_GRAPH_MAX_REF_LENGTH = 1024

export type GitGraphOptions = {
  scope?: GitGraphScope
  ref?: string
  limit?: number
  cursor?: string
}

export type GitGraphResult = {
  items: GitHistoryItem[]
  refs: GitHistoryItemRef[]
  headOid?: string
  currentRef?: GitHistoryItemRef
  scope: GitGraphScope
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
