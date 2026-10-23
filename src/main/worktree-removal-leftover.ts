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

/**
 * Whether a checkout path Git no longer registers still holds the removed checkout's own leftover:
 * no `.git` (Git deleted it first), or a `.git` file naming the admin entry Git removed. Any other
 * `.git` is a different checkout created at the path since.
 */
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

/** The refusal when the path no longer holds the removed checkout's own leftover. */
export function differentCheckoutAtPathError(worktreePath: string): Error {
  return new Error(
    `A different checkout is now at ${worktreePath}; Orca left it in place. Delete it again to remove it.`
  )
}

/** Whether Git registers a checkout at the recorded path now. */
export async function isCheckoutRegistered(record: {
  repoPath: string
  worktreePath: string
}): Promise<boolean> {
  return (await listWorktreesStrict(record.repoPath)).some((worktree) =>
    areWorktreePathsEqual(worktree.path, record.worktreePath)
  )
}

/**
 * A nonempty folder Git no longer registers needs manual removal to protect replacement files.
 */
export function unregisteredFolderRefusal(worktreePath: string): Error {
  return new Error(
    `${worktreePath} is no longer a Git worktree, so its folder was left on disk. Delete the folder yourself to finish removing this workspace.`
  )
}

/**
 * Allows a missing or empty directory, naming any nested registered worktree before refusing.
 */
export async function assertUnregisteredCheckoutRemovable(
  worktreePath: string,
  registeredWorktrees: readonly Pick<GitWorktreeInfo, 'path'>[] = []
): Promise<void> {
  if (await worktreeCheckoutExists(worktreePath)) {
    // Why first: removing the folder, as the refusal asks, would delete that worktree's files too.
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

/**
 * Delete's choice for a workspace whose earlier delete failed, from Git's listing taken now: a
 * checkout Git registers at the path again is the normal delete's, so the failed record is dropped;
 * a nonempty unregistered folder is refused; a missing or empty folder lets `retry` finish.
 */
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
