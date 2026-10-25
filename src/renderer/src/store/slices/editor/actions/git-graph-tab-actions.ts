import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  captureEditorFileOperationProvenance,
  type EditorFileOperationProvenance
} from '@/lib/editor-file-operation-owner'
import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import type { OpenFile } from '../types/open-file'
import { openWorkspaceEditorItem } from '../tabs/workspace-editor-item'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'

/** One graph tab per workspace and owning host; a replaced host gets its own tab. */
export function buildGitGraphTabId(
  worktreeId: string,
  route: { executionHostId: ExecutionHostId; runtimeEnvironmentId: string | null }
): string {
  const runtimeKey = route.runtimeEnvironmentId?.trim() || 'local'
  return `git-graph:${encodeURIComponent(worktreeId)}:${encodeURIComponent(runtimeKey)}:${encodeURIComponent(route.executionHostId)}`
}

function notifyOwnerUnavailable(): void {
  toast.error(
    translate(
      'auto.store.slices.editor.gitGraphOwnerUnavailable',
      "Couldn't verify which host owns this workspace. Try again after the connection settles."
    )
  )
}

export function createGitGraphTabActions(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'openGitGraph'> {
  return {
    openGitGraph: (worktreeId) => {
      let operationProvenance: EditorFileOperationProvenance
      try {
        // Why: capture the owner now so a later workspace focus or host switch cannot retarget the tab.
        operationProvenance = captureEditorFileOperationProvenance(
          get(),
          worktreeId,
          undefined,
          false
        )
      } catch {
        notifyOwnerUnavailable()
        return
      }
      const { executionHostId, runtimeEnvironmentId } = operationProvenance.generation.route
      // Why: an unknown host cannot authorize Git reads, so fail closed instead of guessing local.
      if (!executionHostId) {
        notifyOwnerUnavailable()
        return
      }
      const id = buildGitGraphTabId(worktreeId, { executionHostId, runtimeEnvironmentId })
      const label = translate('auto.store.slices.editor.gitGraphTabLabel', 'Git Graph')
      set((s) => {
        const existing = s.openFiles.some((f) => f.id === id)
        const newFile: OpenFile = {
          id,
          filePath: id,
          relativePath: label,
          worktreeId,
          language: 'plaintext',
          isDirty: false,
          runtimeEnvironmentId,
          operationProvenance,
          mode: 'git-graph'
        }
        return {
          // Why: the id pins the host, so a reopen only refreshes that host's connection generation.
          openFiles: existing
            ? s.openFiles.map((f) => (f.id === id ? { ...f, operationProvenance } : f))
            : [...s.openFiles, newFile],
          activeFileId: id,
          activeTabType: 'editor',
          activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
          activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
        }
      })
      const state = get()
      // Why: one graph per workspace and host, so a reopen focuses it in whichever split group holds it.
      const existingTab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
        (tab) => tab.entityId === id && tab.contentType === 'git-graph'
      )
      if (existingTab) {
        state.activateTab(existingTab.id, { worktreeId })
        return
      }
      openWorkspaceEditorItem(state, id, worktreeId, label, 'git-graph')
    }
  }
}
