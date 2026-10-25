import { resolve } from 'node:path'
import type { RuntimeStore } from '../runtime/runtime-store-contract'
import { resolveAuthorizedPath } from './filesystem-auth'
import { resolveRegisteredWorktreePath } from './registered-worktree-roots-cache'

function comparableLocalPath(value: string): string {
  const normalized = resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export async function resolveRegisteredWorkspaceReadPath(
  requestedPath: string,
  store: RuntimeStore
): Promise<string> {
  try {
    return await resolveRegisteredWorktreePath(requestedPath, store)
  } catch (error) {
    const isFolderWorkspaceRoot = (store.getFolderWorkspaces?.() ?? []).some(
      (workspace) =>
        comparableLocalPath(workspace.folderPath) === comparableLocalPath(requestedPath)
    )
    if (!isFolderWorkspaceRoot) {
      throw error
    }
    return resolveAuthorizedPath(requestedPath, store)
  }
}
