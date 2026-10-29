import {
  editor as monacoEditor,
  type Uri,
  type editor,
  type IPosition,
  type IRange
} from 'monaco-editor'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import { relativePathInsideRoot } from '../../../../../shared/cross-platform-path'
import { languageServerDocumentFor } from './language-server-documents'

// Why a cap: a references result can name hundreds of files; Peek previews only the few seen.
const PRELOAD_LIMIT = 20
// Why: past this, a preview costs more than reading the file in its own tab.
const PRELOAD_MAX_CHARS = 2_000_000
// Why: a model created for a Peek preview is dropped once nothing shows it.
const PREVIEW_SWEEP_MS = 60_000

const previewModels = new Set<editor.ITextModel>()
let sweepTimer: ReturnType<typeof setInterval> | null = null

function sweepPreviews(): void {
  const shown = new Set(monacoEditor.getEditors().map((instance) => instance.getModel()))
  for (const model of previewModels) {
    if (model.isDisposed() || !shown.has(model)) {
      previewModels.delete(model)
      if (!model.isDisposed()) {
        model.dispose()
      }
    }
  }
  if (previewModels.size === 0 && sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}

/**
 * Peek and the references list read target files from Monaco models. Create read-only preview
 * models for local targets that have none, so a definition in an unopened header previews.
 */
export async function preloadLocationModels(uris: readonly Uri[]): Promise<void> {
  const wanted = [...new Map(uris.map((uri) => [uri.toString(), uri])).values()]
    .filter((uri) => uri.scheme === 'file' && !monacoEditor.getModel(uri))
    .slice(0, PRELOAD_LIMIT)
  await Promise.all(
    wanted.map(async (uri) => {
      try {
        const file = await window.api.fs.readFile({
          filePath: uri.fsPath,
          access: { kind: 'user-file' }
        })
        if (
          file.isBinary ||
          file.content.length > PRELOAD_MAX_CHARS ||
          monacoEditor.getModel(uri)
        ) {
          return
        }
        previewModels.add(monacoEditor.createModel(file.content, detectLanguage(uri.fsPath), uri))
        sweepTimer ??= setInterval(sweepPreviews, PREVIEW_SWEEP_MS)
      } catch {
        // An unreadable target just previews empty; jumping to it still opens a tab.
      }
    })
  )
}

/** Opens a "Go to Definition" target from a language-server editor in an Orca tab. */
export function openLanguageServerTarget(
  source: editor.ICodeEditor,
  resource: Uri,
  selectionOrPosition?: IRange | IPosition
): boolean {
  const sourceModel = source.getModel()
  const sourceDocument = sourceModel ? languageServerDocumentFor(sourceModel) : undefined
  if (!sourceDocument || resource.scheme !== 'file') {
    return false
  }
  const state = useAppStore.getState()
  const sourceFile = state.openFiles.find((file) => sourceDocument.fileIds.has(file.id))
  if (!sourceFile) {
    return false
  }
  const filePath = resource.fsPath
  const preview = monacoEditor.getModel(resource)
  // Why: the tab must build its own model from disk; a stale preview would stand in for it.
  if (preview && previewModels.delete(preview) && !preview.isDisposed()) {
    preview.dispose()
  }
  // Why the workspace, not the server root: a crate's server starts in its own directory.
  const workspaceRoot =
    state.getKnownWorktreeById(sourceFile.worktreeId)?.path ?? sourceDocument.entry.rootPath
  const relativePath = relativePathInsideRoot(workspaceRoot, filePath)
  const groupId = state.unifiedTabsByWorktree[sourceFile.worktreeId]?.find(
    (tab) => tab.entityId === sourceFile.id && tab.contentType === 'editor'
  )?.groupId
  const fileId = state.openFile(
    {
      filePath,
      // A target outside the workspace (a system header) opens by its absolute path, read-only.
      relativePath: relativePath || filePath,
      worktreeId: sourceFile.worktreeId,
      language: detectLanguage(filePath),
      mode: 'edit',
      ...(relativePath ? {} : { readOnly: true })
    },
    { targetGroupId: groupId, focusEditor: true }
  )
  const position =
    selectionOrPosition && 'startLineNumber' in selectionOrPosition
      ? { lineNumber: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
      : selectionOrPosition
  if (position) {
    scheduleEditorLineReveal(
      useAppStore.getState,
      filePath,
      position.lineNumber,
      position.column,
      fileId
    )
  }
  return true
}
