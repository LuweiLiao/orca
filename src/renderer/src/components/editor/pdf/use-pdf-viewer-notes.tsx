import { type ReactNode, type RefObject, useCallback, useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EventBus, PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { SynctexRect } from './pdf-synctex-parser'
import { PdfNotesLayer } from './PdfNotesLayer'
import { PdfNotesToolbar } from './PdfNotesToolbar'
import { usePdfNotes } from './use-pdf-notes'

/**
 * Review notes for the PDF in editor tab `editorFileId`: the layer over the pages (with the hint
 * shown while marking) and the footer controls. Both are null outside a workspace's editor tab.
 */
export function usePdfViewerNotes({
  editorFileId,
  filePath,
  containerRef,
  shown
}: {
  editorFileId: string | undefined
  filePath: string
  containerRef: RefObject<HTMLDivElement | null>
  shown: {
    doc: PDFDocumentProxy
    viewer: InstanceType<typeof PdfJsViewer>
    eventBus: InstanceType<typeof EventBus>
    revealRect: (rect: SynctexRect) => void
  } | null
}): { layer: ReactNode; toolbar: ReactNode } {
  const t = useTranslate()
  const { owner, worktreeId, notes, addNote } = usePdfNotes(editorFileId)
  const [annotating, setAnnotating] = useState(false)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)

  const goToNextNote = useCallback(() => {
    if (!shown || notes.length === 0) {
      return
    }
    const current = notes.findIndex((note) => note.id === activeNoteId)
    const next = notes[(current + 1) % notes.length]
    shown.revealRect(next.pdfRegion)
    setActiveNoteId(next.id)
  }, [activeNoteId, notes, shown])

  useEffect(() => {
    if (!annotating) {
      return
    }
    // Why window: a press on the page keeps focus where it was, so the page never holds it.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      if (document.querySelector('[data-pdf-note-ui][data-state="open"]')) {
        return
      }
      setAnnotating(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [annotating])

  if (!editorFileId || !worktreeId) {
    return { layer: null, toolbar: null }
  }
  return {
    layer: (
      <>
        {shown ? (
          <PdfNotesLayer
            viewer={shown.viewer}
            eventBus={shown.eventBus}
            doc={shown.doc}
            containerRef={containerRef}
            fileId={editorFileId}
            owner={owner}
            worktreeId={worktreeId}
            notes={notes}
            annotating={annotating}
            activeNoteId={activeNoteId}
            onActiveNoteChange={setActiveNoteId}
            onAddNote={addNote}
          />
        ) : null}
        {annotating ? (
          <div
            role="status"
            data-pdf-annotate-hint=""
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-popover py-1 pl-3 pr-1 text-xs text-popover-foreground shadow-floating"
          >
            <span>
              {t(
                'auto.components.editor.PdfViewer.annotateHint',
                'Drag over the page to mark what the note is about'
              )}
            </span>
            <Button type="button" variant="ghost" size="xs" onClick={() => setAnnotating(false)}>
              {t('auto.components.editor.MarkdownPreview.e4683f70c4', 'Cancel')}
            </Button>
          </div>
        ) : null}
      </>
    ),
    toolbar: (
      <PdfNotesToolbar
        owner={owner}
        worktreeId={worktreeId}
        filePath={filePath}
        notes={notes}
        annotating={annotating}
        onAnnotatingChange={setAnnotating}
        onNextNote={goToNextNote}
      />
    )
  }
}
