import { lstat, readdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RemoveWorktreeResult } from '../shared/worktree/create-types'
import type { GitWorktreeInfo } from '../shared/worktree/types'
import { listWorktreesStrict } from './git/worktree'
import { getErrorCode } from './git/worktree-operation-options'
import { areWorktreePathsEqual } from './git/worktree-path-comparison'
import { CLIENT_REMOVAL_HOME } from './worktree-removal-home-guard'
import { toHostRemovalPath } from './host-tree-removal'
import {
  failedWorktreeRemovals,
  persistWorktreeRemovalRecords,
  worktreeCheckoutExists
} from './worktree-removal-table'
import {
  assertWorktreeDoesNotContainRegisteredWorktree,
  canSafelyRemoveOrphanedWorktreeDirectory,
  isDangerousWorktreeRemovalPath
} from './worktree-removal-safety'

/** Absent .git or a proven orphan marker can identify a leftover; live or foreign registrations cannot. */
export async function isUnregisteredRemovalLeftover(
  repoPath: string,
  worktreePath: string
): Promise<boolean> {
  try {
    await lstat(join(worktreePath, '.git'))
  } catch (error) {
    return getErrorCode(error) === 'ENOENT'
  }
  return canSafelyRemoveOrphanedWorktreeDirectory(worktreePath, repoPath, CLIENT_REMOVAL_HOME)
}

export function differentCheckoutAtPathError(worktreePath: string): Error {
  return new Error(
    `A different checkout is now at ${worktreePath}; Orca left it in place. Delete it again to remove it.`
  )
}

export async function isCheckoutRegistered(record: {
  repoPath: string
  worktreePath: string
}): Promise<boolean> {
  return (await listWorktreesStrict(record.repoPath)).some((worktree) =>
    areWorktreePathsEqual(worktree.path, record.worktreePath)
  )
}

export function unregisteredFolderRefusal(worktreePath: string): Error {
  return new Error(
    `${worktreePath} is no longer a Git worktree, so its folder was left on disk. Delete the folder yourself to finish removing this workspace.`
  )
}

/** Allow missing or empty folders; name nested worktrees before refusing removal. */
export async function assertUnregisteredCheckoutRemovable(
  worktreePath: string,
  registeredWorktrees: readonly Pick<GitWorktreeInfo, 'path'>[] = []
): Promise<void> {
  if (await worktreeCheckoutExists(worktreePath)) {
    assertWorktreeDoesNotContainRegisteredWorktree(worktreePath, registeredWorktrees)
    try {
      const stat = await lstat(worktreePath)
      if (
        stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        (await readdir(worktreePath)).length === 0
      ) {
        return
      }
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') {
        return
      }
      throw error
    }
    throw unregisteredFolderRefusal(worktreePath)
  }
}

export async function removeEmptyUnregisteredCheckout(
  repoPath: string,
  worktreePath: string
): Promise<void> {
  if (isDangerousWorktreeRemovalPath(worktreePath, repoPath, CLIENT_REMOVAL_HOME)) {
    throw new Error(`Refusing to delete protected worktree path: ${worktreePath}`)
  }
  await assertUnregisteredCheckoutRemovable(worktreePath)
  try {
    // Nonrecursive: files created after the empty check must prevent deletion.
    await rmdir(toHostRemovalPath(worktreePath))
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') {
      throw error
    }
  }
}

/** Registered paths use normal deletion; missing or empty folders allow recorded cleanup to retry. */
export async function retryFailedRemovalUnlessRegistered(
  worktreeId: string,
  worktreePath: string,
  registeredWorktrees: readonly Pick<GitWorktreeInfo, 'path'>[],
  retry: () => Promise<RemoveWorktreeResult> | undefined
): Promise<boolean> {
  if (registeredWorktrees.some((worktree) => areWorktreePathsEqual(worktree.path, worktreePath))) {
    if (failedWorktreeRemovals.delete(worktreeId)) {
      void persistWorktreeRemovalRecords()
    }
    return false
  }
  const failed = failedWorktreeRemovals.get(worktreeId)
  if (failed) {
    await assertUnregisteredCheckoutRemovable(failed.worktreePath, registeredWorktrees)
  }
  return retry() !== undefined
}
