import type { OpenFile } from '@/store/slices/editor'
import type { AppState } from '@/store/types'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { getRuntimeTargetForFileOwner } from '@/lib/file-owner-runtime-target'
import type { LanguageServerId } from '../../../../../shared/language-server-types'
import { relativePathInsideRoot } from '../../../../../shared/cross-platform-path'

/** Monaco language ids answered by a language server, with the server and its LSP id. */
const SERVER_FOR_LANGUAGE: Record<string, { serverId: LanguageServerId; lspLanguageId: string }> = {
  c: { serverId: 'clangd', lspLanguageId: 'c' },
  cpp: { serverId: 'clangd', lspLanguageId: 'cpp' },
  python: { serverId: 'pyright', lspLanguageId: 'python' },
  rust: { serverId: 'rust-analyzer', lspLanguageId: 'rust' }
}

export const LANGUAGE_SERVER_MONACO_LANGUAGES = Object.keys(SERVER_FOR_LANGUAGE)

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
  if (getConnectionIdForFile(file.worktreeId, file.filePath) !== null) {
    return null
  }
  if (
    getRuntimeTargetForFileOwner(state, file.worktreeId, file.runtimeEnvironmentId)?.kind !==
    'local'
  ) {
    return null
  }
  const rootPath = state.getKnownWorktreeById(file.worktreeId)?.path
  if (!rootPath || /^(\\\\|\/\/)wsl(\$|\.localhost)/i.test(rootPath)) {
    return null
  }
  return relativePathInsideRoot(rootPath, file.filePath) ? { ...server, rootPath } : null
}
