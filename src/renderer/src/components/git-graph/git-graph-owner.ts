import type { AppState } from '@/store/types'
import type { OpenFile } from '@/store/slices/editor'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { findKnownWorktreeById } from '@/store/slices/worktrees/listing/detected-worktree-meta'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import { translate } from '@/i18n/i18n'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { isFolderRepo } from '../../../../shared/repo-kind'

export type GitGraphOwnerFile = Pick<
  OpenFile,
  'worktreeId' | 'runtimeEnvironmentId' | 'externalSshTargetId' | 'operationProvenance'
>

export type GitGraphOwner =
  | { status: 'ready'; key: string; context: RuntimeGitContext & { worktreeId: string } }
  | { status: 'not-git'; key: string }
  | { status: 'unavailable'; key: string; message: string }

/**
 * The graph tab's git owner from the tab's stored workspace and host provenance, never the
 * focused workspace or server. Host replacement fails closed instead of reading another host.
 */
export function resolveGitGraphOwner(state: AppState, file: GitGraphOwnerFile): GitGraphOwner {
  const worktreeId = file.worktreeId
  const capturedHostId = file.operationProvenance?.generation.route.executionHostId ?? undefined
  // Why: a Git folder workspace has no worktree row; its real root comes from the folder catalog.
  const workspace = findKnownWorktreeById(state, worktreeId, capturedHostId)
  if (parseWorkspaceKey(worktreeId)?.type !== 'folder' && workspace) {
    const repo = state.repos.find((candidate) => candidate.id === workspace.repoId)
    if (repo && isFolderRepo(repo)) {
      return { status: 'not-git', key: `not-git:${worktreeId}` }
    }
  }
  let context: ReturnType<typeof getEditorFileOperationContext>
  try {
    context = getEditorFileOperationContext(state, file, workspace?.path ?? null)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'unavailable', key: `unavailable:${worktreeId}:${message}`, message }
  }
  if (!context.worktreePath) {
    const message = translate(
      'auto.components.gitGraph.owner.workspaceMissing',
      'This workspace is no longer available.'
    )
    return { status: 'unavailable', key: `unavailable:${worktreeId}:missing`, message }
  }
  const target = context.target
  return {
    status: 'ready',
    key: JSON.stringify([
      target.kind === 'environment' ? target.environmentId : 'local',
      worktreeId,
      context.worktreePath,
      context.connectionId ?? null
    ]),
    context: {
      target,
      worktreeId,
      worktreePath: context.worktreePath,
      connectionId: context.connectionId
    }
  }
}
