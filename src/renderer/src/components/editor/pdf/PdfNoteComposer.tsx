import { type JSX, useCallback, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useTranslate } from '@/i18n/use-translate'
import { formatMarkdownReviewCardQuote } from '@/lib/editor/markdown/review-notes/markdown-review-notes'
import { ImeTextarea } from '@/lib/text-input/ime/ime-text-field'
import type { PdfNoteTexSource } from '../../../../../shared/file-review/diff-comment-types'
import { formatPdfNoteTexLocation } from '../../../../../shared/file-review/diff-comments-format'

/** The note box for a region just marked on a PDF page: what it covers, and the note itself. */
export function PdfNoteComposer({
  page,
  excerpt,
  texSource,
  body,
  onBodyChange,
  onCancel,
  onSubmit
}: {
  page: number
  /** null while the region's text is still being read. */
  excerpt: string | null
  texSource: PdfNoteTexSource | null
  /** Held by the draft, so text typed survives leaving and re-entering marking mode. */
  body: string
  onBodyChange: (body: string) => void
  onCancel: () => void
  onSubmit: (body: string) => Promise<boolean>
}): JSX.Element {
  const t = useTranslate()
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useMountedRef()
  const trimmed = body.trim()
  const quote = excerpt ? formatMarkdownReviewCardQuote(excerpt) : undefined

  const focusTextarea = useCallback((textarea: HTMLTextAreaElement | null): void => {
    textarea?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    if (submitting || !trimmed) {
      return
    }
    setSubmitting(true)
    await onSubmit(trimmed).finally(() => {
      if (mountedRef.current) {
        setSubmitting(false)
      }
    })
  }

  return (
    <div className="flex flex-col gap-2" data-pdf-note-composer="">
      <div className="flex min-w-0 items-baseline gap-2 text-2xs text-muted-foreground">
        <span className="shrink-0">{t('diffComments.pageMeta', 'page {{page}}', { page })}</span>
        {texSource ? (
          <span className="min-w-0 truncate font-mono" title={formatPdfNoteTexLocation(texSource)}>
            {formatPdfNoteTexLocation(texSource)}
          </span>
        ) : null}
      </div>
      {quote ? (
        <div className="orca-diff-comment-quote">
          <div className="orca-diff-comment-quote-text">{quote}</div>
        </div>
      ) : null}
      <ImeTextarea
        ref={focusTextarea}
        className="orca-diff-comment-popover-textarea"
        placeholder={t('auto.components.editor.MarkdownPreview.d737791433', 'Add note for the AI')}
        value={body}
        onChange={(event) => {
          onBodyChange(event.target.value)
          const el = event.currentTarget
          el.style.height = 'auto'
          el.style.height = `${Math.min(el.scrollHeight, 240)}px`
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
        rows={3}
      />
      <div className="orca-diff-comment-popover-footer">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
          {t('auto.components.editor.MarkdownPreview.e4683f70c4', 'Cancel')}
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={submitting || !trimmed}>
          {submitting
            ? t('auto.components.editor.MarkdownPreview.d652c87c91', 'Saving…')
            : t('auto.components.editor.MarkdownPreview.13f94d760c', 'Add note')}
          {!submitting && <CornerDownLeft className="ml-1 size-3 opacity-70" />}
        </Button>
      </div>
    </div>
  )
}
