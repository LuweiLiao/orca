import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { OpenFile } from '@/store/slices/editor'
import { translate } from '@/i18n/i18n'
import { detectLanguage } from '@/lib/language-detect'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import {
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../../../shared/cross-platform-path'
import type { SynctexRect } from './pdf-synctex-parser'
import { synctexForward, synctexReverse } from './pdf-synctex-lookup'
import { loadPdfSynctex } from './pdf-synctex-source'

export const PDF_SYNCTEX_REVEAL_EVENT = 'orca:pdf-synctex-reveal'
// Why: a reveal whose PDF never mounts (closed meanwhile) must not fire on a later open.
const PENDING_REVEAL_TTL_MS = 10_000
const pendingReveals = new Map<string, { rect: SynctexRect; expiresAt: number }>()

/** The reveal waiting for PDF tab `fileId`, consumed once its viewer can show it. */
export function takePendingPdfSynctexReveal(fileId: string): SynctexRect | null {
  const pending = pendingReveals.get(fileId)
  pendingReveals.delete(fileId)
  return pending && pending.expiresAt > Date.now() ? pending.rect : null
}

function editorTabOf(state: AppState, file: OpenFile) {
  return state.unifiedTabsByWorktree[file.worktreeId]?.find(
    (tab) => tab.entityId === file.id && tab.contentType === 'editor'
  )
}

/** Another split group than `groupId`, so the jump target opens beside its source. */
function groupBeside(state: AppState, worktreeId: string, groupId: string | undefined) {
  return state.groupsByWorktree[worktreeId]?.find((group) => group.id !== groupId)?.id
}

function openFileById(state: AppState, fileId: string): OpenFile | undefined {
  return state.openFiles.find((file) => file.id === fileId)
}

/** PDF → source: opens the line behind a spot on a page of PDF tab `pdfFileId`. */
export async function openPdfSynctexSource(
  pdfFileId: string,
  point: { page: number; x: number; y: number }
): Promise<void> {
  const pdf = openFileById(useAppStore.getState(), pdfFileId)
  if (!pdf) {
    return
  }
  const data = await loadPdfSynctex(pdf)
  const source = data ? synctexReverse(data, point.page, point.x, point.y) : null
  if (!source) {
    toast.info(
      translate(
        'auto.components.editor.PdfViewer.synctexMissing',
        'No SyncTeX data for this PDF. Build it with -synctex=1.'
      )
    )
    return
  }
  const state = useAppStore.getState()
  const root = state.getKnownWorktreeById(pdf.worktreeId)?.path
  const relativePath = root ? relativePathInsideRoot(root, source.file) : null
  if (!relativePath) {
    toast.info(
      translate(
        'auto.components.editor.PdfViewer.synctexOutsideWorkspace',
        'The source is outside this workspace: {{path}}',
        { path: source.file }
      )
    )
    return
  }
  const wanted = normalizeRuntimePathForComparison(source.file)
  const existing = state.openFiles.find(
    (file) =>
      file.worktreeId === pdf.worktreeId &&
      normalizeRuntimePathForComparison(file.filePath) === wanted
  )
  const existingTab = existing ? editorTabOf(state, existing) : undefined
  const targetGroupId =
    existingTab?.groupId ?? groupBeside(state, pdf.worktreeId, editorTabOf(state, pdf)?.groupId)
  const filePath = existing?.filePath ?? source.file
  const fileId = state.openFile(
    {
      filePath,
      relativePath,
      worktreeId: pdf.worktreeId,
      language: detectLanguage(relativePath),
      mode: 'edit',
      // The source shares the PDF's host, so it opens under the same owner.
      runtimeEnvironmentId: pdf.runtimeEnvironmentId,
      externalSshTargetId: pdf.externalSshTargetId
    },
    { targetGroupId, focusEditor: true }
  )
  scheduleEditorLineReveal(useAppStore.getState, filePath, source.line, 1, fileId)
}

/**
 * Source → PDF: shows where `line` of tex tab `texFileId` landed, in the open PDF built from it,
 * else in the same-named PDF beside it.
 */
export async function revealSourceLineInPdf(texFileId: string, line: number): Promise<void> {
  const state = useAppStore.getState()
  const tex = openFileById(state, texFileId)
  if (!tex) {
    return
  }
  const siblingPath = tex.filePath.replace(/\.tex$/i, '.pdf')
  const candidates = state.openFiles.filter(
    (file) => file.worktreeId === tex.worktreeId && /\.pdf$/i.test(file.filePath)
  )
  const sibling: OpenFile | null =
    siblingPath !== tex.filePath && !candidates.some((file) => file.filePath === siblingPath)
      ? {
          ...tex,
          id: siblingPath,
          filePath: siblingPath,
          relativePath: tex.relativePath.replace(/\.tex$/i, '.pdf'),
          isDirty: false
        }
      : null
  for (const pdf of sibling ? [...candidates, sibling] : candidates) {
    const data = await loadPdfSynctex(pdf)
    const rect = data ? synctexForward(data, tex.filePath, line) : null
    if (rect) {
      showPdfAt(pdf, rect, pdf === sibling, tex)
      return
    }
  }
  toast.info(
    translate(
      'auto.components.editor.MonacoEditor.synctexNoPdf',
      'No PDF with SyncTeX data was built from this file. Open the PDF, or build it with -synctex=1.'
    )
  )
}

function showPdfAt(pdf: OpenFile, rect: SynctexRect, notOpenYet: boolean, tex: OpenFile): void {
  const state = useAppStore.getState()
  const texGroupId = editorTabOf(state, tex)?.groupId
  const pdfTab = notOpenYet ? undefined : editorTabOf(state, pdf)
  const fileId = state.openFile(
    {
      filePath: pdf.filePath,
      relativePath: pdf.relativePath,
      worktreeId: pdf.worktreeId,
      language: notOpenYet ? 'plaintext' : pdf.language,
      mode: 'edit',
      runtimeEnvironmentId: pdf.runtimeEnvironmentId,
      externalSshTargetId: pdf.externalSshTargetId
    },
    { targetGroupId: pdfTab?.groupId ?? groupBeside(state, pdf.worktreeId, texGroupId) }
  )
  pendingReveals.set(fileId, { rect, expiresAt: Date.now() + PENDING_REVEAL_TTL_MS })
  window.dispatchEvent(new CustomEvent(PDF_SYNCTEX_REVEAL_EVENT, { detail: { fileId } }))
}
