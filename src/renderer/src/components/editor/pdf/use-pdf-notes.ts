import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { isPdfComment } from '@/lib/source-control/review/comments/diff-comment-compat'
import { useDiffCommentView } from '../../diff-comments/use-diff-comment-owner'
import type {
  DiffComment,
  PdfNoteTexSource
} from '../../../../../shared/file-review/diff-comment-types'
import type { SynctexRect } from './pdf-synctex-parser'

export type PdfNote = DiffComment & { source: 'pdf'; pdfRegion: SynctexRect }

function isPlacedPdfNote(comment: DiffComment): comment is PdfNote {
  return isPdfComment(comment) && comment.pdfRegion !== undefined
}

/** Page, then top to bottom, then left to right: the order a reader meets them. */
function comparePdfNotes(a: PdfNote, b: PdfNote): number {
  return (
    a.pdfRegion.page - b.pdfRegion.page ||
    a.pdfRegion.top - b.pdfRegion.top ||
    a.pdfRegion.left - b.pdfRegion.left ||
    a.createdAt - b.createdAt
  )
}

/** The review notes on the PDF open in editor tab `fileId`, kept with the workspace's other notes. */
export function usePdfNotes(fileId: string | undefined) {
  const file = useAppStore((state) =>
    fileId ? state.openFiles.find((candidate) => candidate.id === fileId) : undefined
  )
  // Notes belong to a workspace file; a file opened from outside any workspace has none.
  const worktreeId = file && file.relativePath !== file.filePath ? file.worktreeId : undefined
  const { owner, comments } = useDiffCommentView(worktreeId, file ?? 'selection')
  const relativePath = file?.relativePath
  const notes = useMemo(
    () =>
      (comments ?? [])
        .filter(
          (comment): comment is PdfNote =>
            comment.filePath === relativePath && isPlacedPdfNote(comment)
        )
        .sort(comparePdfNotes),
    [comments, relativePath]
  )

  const addNote = useCallback(
    async (input: {
      region: SynctexRect
      body: string
      selectedText: string
      texSource: PdfNoteTexSource | null
    }): Promise<boolean> => {
      if (!owner || !worktreeId || !relativePath) {
        return false
      }
      const saved = await useAppStore.getState().addDiffComment(owner, {
        worktreeId,
        filePath: relativePath,
        source: 'pdf',
        lineNumber: input.region.page,
        pdfRegion: input.region,
        ...(input.texSource ? { pdfTexSource: input.texSource } : {}),
        ...(input.selectedText ? { selectedText: input.selectedText } : {}),
        body: input.body,
        side: 'modified'
      })
      if (!saved) {
        toast.error(
          translate('auto.components.editor.diffCommentSaveFailed', 'Failed to save comment')
        )
      }
      return saved !== null
    },
    [owner, relativePath, worktreeId]
  )

  return {
    owner,
    worktreeId: owner ? worktreeId : undefined,
    notes,
    addNote
  }
}
