import { hasRuntimeRpcErrorCode } from './runtime-rpc-error-code'

export const GIT_GRAPH_NOT_A_REPOSITORY_CODE = 'git_graph_not_a_repository'
export const GIT_GRAPH_REF_NOT_FOUND_CODE = 'git_graph_ref_not_found'
export const GIT_GRAPH_CURSOR_INVALID_CODE = 'git_graph_cursor_invalid'
/** Snapshot aged out, was evicted, or the host restarted; reload from the first page. */
export const GIT_GRAPH_CURSOR_EXPIRED_CODE = 'git_graph_cursor_expired'
/** Pinned tips no longer walk to the same order (pruned objects, deepened shallow clone). */
export const GIT_GRAPH_SNAPSHOT_CHANGED_CODE = 'git_graph_snapshot_changed'
/** The owning host predates `git.historyGraph`; never answered with HEAD-only history. */
export const GIT_GRAPH_UNSUPPORTED_CODE = 'git_graph_unsupported'

export const GIT_GRAPH_ERROR_CODES = [
  GIT_GRAPH_NOT_A_REPOSITORY_CODE,
  GIT_GRAPH_REF_NOT_FOUND_CODE,
  GIT_GRAPH_CURSOR_INVALID_CODE,
  GIT_GRAPH_CURSOR_EXPIRED_CODE,
  GIT_GRAPH_SNAPSHOT_CHANGED_CODE,
  GIT_GRAPH_UNSUPPORTED_CODE
] as const

export type GitGraphErrorCode = (typeof GIT_GRAPH_ERROR_CODES)[number]

export function getGitGraphErrorCode(error: unknown): GitGraphErrorCode | null {
  return GIT_GRAPH_ERROR_CODES.find((code) => hasRuntimeRpcErrorCode(error, code)) ?? null
}
