import type { OpenFile } from '@/store/slices/editor'
import type { AppState } from '@/store/types'
import { getConnectionIdForFileFromState } from '@/lib/connection-owner-resolution'
import { getRuntimeTargetForFileOwner } from '@/lib/file-owner-runtime-target'
import type { LanguageServerId } from '../../../../../shared/language-server-types'
import { relativePathInsideRoot } from '../../../../../shared/cross-platform-path'

/** Monaco language ids answered by a language server, with the server and its LSP id. */
const SERVER_FOR_LANGUAGE: Record<string, { serverId: LanguageServerId; lspLanguageId: string }> = {
  c: { serverId: 'clangd', lspLanguageId: 'c' },
  cpp: { serverId: 'clangd', lspLanguageId: 'cpp' },
  python: { serverId: 'pyright', lspLanguageId: 'python' },
  rust: { serverId: 'rust-analyzer', lspLanguageId: 'rust' },
  typescript: { serverId: 'typescript', lspLanguageId: 'typescript' },
  javascript: { serverId: 'typescript', lspLanguageId: 'javascript' }
}

/**
 * Monaco's own TypeScript service answers `typescript`/`javascript` models and cannot be turned
 * off per model once loaded. A model whose server is ready switches to these ids, which share the
 * grammar but not the built-in service, so the two never answer the same request twice.
 */
export const LANGUAGE_SERVER_OWNED_LANGUAGES: Record<string, string> = {
  typescript: 'orca-lsp-typescript',
  javascript: 'orca-lsp-javascript'
}

export const LANGUAGE_SERVER_MONACO_LANGUAGES = [
  ...Object.keys(SERVER_FOR_LANGUAGE).filter((id) => !(id in LANGUAGE_SERVER_OWNED_LANGUAGES)),
  ...Object.values(LANGUAGE_SERVER_OWNED_LANGUAGES)
]

// tsserver tells JSX from plain script by the LSP language id, not the file name.
function lspLanguageIdFor(language: string, filePath: string): string | null {
  const server = SERVER_FOR_LANGUAGE[language]
  if (!server) {
    return null
  }
  if (server.serverId === 'typescript' && /\.[jt]sx$/i.test(filePath)) {
    return `${server.lspLanguageId}react`
  }
  return server.lspLanguageId
}

export type LanguageServerRoute = {
  serverId: LanguageServerId
  lspLanguageId: string
  rootPath: string
}

/**
 * The server for a tab, or null. Only files inside a local workspace qualify for now: remote
 * hosts and WSL need the server to run there, which comes later.
 */
export function languageServerRouteFor(
  state: AppState,
  file: OpenFile,
  language: string
): LanguageServerRoute | null {
  const server = SERVER_FOR_LANGUAGE[language]
  if (!server || file.readOnly || file.externalSshTargetId || file.relativePath === file.filePath) {
    return null
  }
  if (getConnectionIdForFileFromState(state, file.worktreeId, file.filePath) !== null) {
    return null
  }
  if (
    getRuntimeTargetForFileOwner(state, file.worktreeId, file.runtimeEnvironmentId)?.kind !==
    'local'
  ) {
    return null
  }
  // Why optional: a partially hydrated store (startup, tests) has no worktree lookup yet.
  const rootPath = state.getKnownWorktreeById?.(file.worktreeId)?.path
  if (!rootPath || /^(\\\\|\/\/)wsl(\$|\.localhost)/i.test(rootPath)) {
    return null
  }
  const lspLanguageId = lspLanguageIdFor(language, file.filePath)
  return lspLanguageId && relativePathInsideRoot(rootPath, file.filePath)
    ? { serverId: server.serverId, lspLanguageId, rootPath }
    : null
}
