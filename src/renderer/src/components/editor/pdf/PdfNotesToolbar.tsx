import type { JSX } from 'react'
import { MessageSquare, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import type { DiffCommentOwner } from '@/store/slices/diff-comments/diff-comment-owner'
import { formatDiffComments } from '../../../../../shared/file-review/diff-comments-format'
import { NotesSendMenu } from '../review-note-delivery/NotesSendMenu'
import { ViewerToolbarButton } from '../viewer-viewport/ViewerToolbarButton'
import type { PdfNote } from './use-pdf-notes'

/** The PDF toolbar's note controls: mark a region, step through the notes, send them to an agent. */
export function PdfNotesToolbar({
  owner,
  worktreeId,
  filePath,
  notes,
  annotating,
  onAnnotatingChange,
  onNextNote
}: {
  owner: DiffCommentOwner | null
  worktreeId: string
  filePath: string
  notes: readonly PdfNote[]
  annotating: boolean
  onAnnotatingChange: (annotating: boolean) => void
  onNextNote: () => void
}): JSX.Element {
  const t = useTranslate()
  const unsent = notes.filter((note) => !note.sentAt)
  return (
    <div className="flex items-center gap-0.5">
      <ViewerToolbarButton
        label={t('auto.components.editor.PdfViewer.annotate', 'Mark a region to note')}
        pressed={annotating}
        onClick={() => onAnnotatingChange(!annotating)}
      >
        <MessageSquarePlus />
      </ViewerToolbarButton>
      {notes.length > 0 ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={t('auto.components.editor.PdfViewer.nextNote', 'Next note')}
            onClick={onNextNote}
          >
            <MessageSquare className="size-3.5" />
            <span className="tabular-nums">{notes.length}</span>
          </Button>
          <NotesSendMenu
            owner={owner}
            worktreeId={worktreeId}
            groupId={worktreeId}
            modeIdParts={['pdf-notes', worktreeId, filePath, 'toolbar']}
            scopes={[
              {
                id: 'file',
                label: t('auto.components.editor.DiffNotesSendMenu.f1aa04b5cf', 'This file'),
                notes: unsent,
                formatPrompt: formatDiffComments
              }
            ]}
            triggerClassName="size-6"
            align="end"
            onDelivered={(delivered) =>
              void (owner && useAppStore.getState().clearDeliveredDiffComments(owner, delivered))
            }
          />
        </>
      ) : null}
    </div>
  )
}
