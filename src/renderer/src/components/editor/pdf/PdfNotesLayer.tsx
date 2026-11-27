import {
  type CSSProperties,
  type JSX,
  type Ref,
  type RefObject,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EventBus, PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import type { DiffCommentOwner } from '@/store/slices/diff-comments/diff-comment-owner'
import { formatMarkdownReviewCardQuote } from '@/lib/editor/markdown/review-notes/markdown-review-notes'
import { DiffCommentCard } from '../../diff-comments/DiffCommentCard'
import { getDiffCommentLineMetaLabel } from '../../diff-comments/diff-comment-line-meta-label'
import { NotesSendMenu } from '../review-note-delivery/NotesSendMenu'
import { formatDiffComments } from '../../../../../shared/file-review/diff-comments-format'
import type { PdfNoteTexSource } from '../../../../../shared/file-review/diff-comment-types'
import type { SynctexRect } from './pdf-synctex-parser'
import { pdfPageGeometry, pdfRectToPagePixels } from './pdf-page-geometry'
import { usePdfPageHosts } from './use-pdf-page-hosts'
import { usePdfNoteDrag, type PdfNoteDrag } from './use-pdf-note-drag'
import { PdfNoteComposer } from './PdfNoteComposer'
import { readPdfRegionText } from './pdf-region-text'
import { pdfRegionTexSource } from './pdf-synctex-navigation'
import type { PdfNote } from './use-pdf-notes'
import type { PdfTextSelection } from './pdf-text-selection'

type DraftDetails = { excerpt: string; texSource: PdfNoteTexSource | null }
type Draft = {
  region: SynctexRect
  /** Read once the region is marked; a note added before it settles waits for it. */
  details: Promise<DraftDetails>
  excerpt: string | null
  texSource: PdfNoteTexSource | null
  body: string
  /** Made from selected text, so it shows outside marking mode too. */
  fromSelection: boolean
}

/** A box on a page as percentages of the page, so it stays put through zooms between renders. */
function percentBox(
  page: HTMLElement,
  box: { left: number; top: number; width: number; height: number }
): CSSProperties {
  const width = page.clientWidth || 1
  const height = page.clientHeight || 1
  return {
    position: 'absolute',
    left: `${(box.left / width) * 100}%`,
    top: `${(box.top / height) * 100}%`,
    width: `${(box.width / width) * 100}%`,
    height: `${(box.height / height) * 100}%`
  }
}

function regionStyle(
  viewer: InstanceType<typeof PdfJsViewer>,
  region: SynctexRect
): CSSProperties | null {
  const page = pdfPageGeometry(viewer, region.page)
  return page ? percentBox(page.div, pdfRectToPagePixels(page, region)) : null
}

function dragStyle(
  viewer: InstanceType<typeof PdfJsViewer>,
  drag: PdfNoteDrag
): CSSProperties | null {
  const page = pdfPageGeometry(viewer, drag.page)
  return page ? percentBox(page.div, drag.box) : null
}

type AddPdfNote = (input: {
  region: SynctexRect
  body: string
  selectedText: string
  texSource: PdfNoteTexSource | null
}) => Promise<boolean>

/** Review notes drawn on their PDF pages, and marking a new one by dragging over a page. */
export function PdfNotesLayer({
  viewer,
  eventBus,
  doc,
  containerRef,
  fileId,
  owner,
  worktreeId,
  notes,
  annotating,
  activeNoteId,
  onActiveNoteChange,
  onAddNote,
  selectionNoteRef
}: {
  viewer: InstanceType<typeof PdfJsViewer>
  eventBus: InstanceType<typeof EventBus>
  doc: PDFDocumentProxy
  containerRef: RefObject<HTMLDivElement | null>
  fileId: string
  owner: DiffCommentOwner | null
  worktreeId: string
  notes: readonly PdfNote[]
  annotating: boolean
  activeNoteId: string | null
  onActiveNoteChange: (noteId: string | null) => void
  onAddNote: AddPdfNote
  /** Opens a note on the text the user selected, from the selection's offer outside this layer. */
  selectionNoteRef: Ref<(selection: PdfTextSelection) => void>
}): JSX.Element {
  const [markedDraft, setDraft] = useState<Draft | null>(null)
  const draftDirtyRef = useRef(false)
  const drag = usePdfNoteDrag({
    viewer,
    containerRef,
    enabled: annotating,
    // A typed note is kept until it is added or cancelled; a blank one gives way to a new drag.
    canStart: () => !draftDirtyRef.current,
    onStart: () => {
      setDraft(null)
      onActiveNoteChange(null)
    },
    onRegion: (region) => startDraft(region, null)
  })

  // `excerpt` is the selected text when there is one; a dragged region reads what lies inside it.
  const startDraft = (region: SynctexRect, excerpt: string | null): void => {
    draftDirtyRef.current = false
    onActiveNoteChange(null)
    const details = Promise.all([
      excerpt ?? readPdfRegionText(doc, region).catch(() => ''),
      pdfRegionTexSource(fileId, region).catch(() => null)
    ]).then(([text, texSource]) => ({ excerpt: text, texSource }))
    setDraft({
      region,
      details,
      excerpt,
      texSource: null,
      body: '',
      fromSelection: excerpt !== null
    })
    void details.then((read) =>
      setDraft((current) => (current?.region === region ? { ...current, ...read } : current))
    )
  }
  useImperativeHandle(selectionNoteRef, () => (selection) => {
    if (draftDirtyRef.current) {
      return
    }
    window.getSelection()?.removeAllRanges()
    startDraft(selection.region, selection.text)
  })

  // Leaving marking mode hides a dragged draft; a typed one comes back with the mode.
  const draft = annotating || markedDraft?.fromSelection ? markedDraft : null

  const pages = [
    ...notes.map((note) => note.pdfRegion.page),
    ...(draft ? [draft.region.page] : []),
    ...(drag ? [drag.page] : [])
  ]
  const hostFor = usePdfPageHosts(viewer, eventBus, pages)

  const cancelDraft = (): void => {
    draftDirtyRef.current = false
    setDraft(null)
  }

  return (
    <>
      {notes.map((note, index) => {
        const style = regionStyle(viewer, note.pdfRegion)
        return style
          ? createPortal(
              <PdfNoteMark
                note={note}
                index={index}
                style={style}
                active={activeNoteId === note.id}
                owner={owner}
                worktreeId={worktreeId}
                onActiveChange={(active) => onActiveNoteChange(active ? note.id : null)}
              />,
              hostFor(note.pdfRegion.page),
              note.id
            )
          : null
      })}
      {drag
        ? createPortal(
            <div
              data-pdf-note-drag=""
              style={dragStyle(viewer, drag) ?? undefined}
              className="rounded-sm border-2 border-dashed border-ring bg-ring/10"
            />,
            hostFor(drag.page),
            'drag'
          )
        : null}
      {draft
        ? createPortal(
            <Popover
              open
              onOpenChange={(open) => {
                if (!open && !draftDirtyRef.current) {
                  cancelDraft()
                }
              }}
            >
              <PopoverAnchor asChild>
                <div
                  data-pdf-note-draft=""
                  style={regionStyle(viewer, draft.region) ?? undefined}
                  className="rounded-sm border-2 border-dashed border-ring bg-ring/10"
                />
              </PopoverAnchor>
              <PopoverContent
                side="bottom"
                align="start"
                className="w-80"
                data-pdf-note-ui=""
                // Why: a typed note must survive a stray click on the page.
                onInteractOutside={(event) => {
                  if (draftDirtyRef.current) {
                    event.preventDefault()
                  }
                }}
              >
                <div className="p-3">
                  <PdfNoteComposer
                    page={draft.region.page}
                    excerpt={draft.excerpt}
                    texSource={draft.texSource}
                    body={draft.body}
                    onBodyChange={(body) => {
                      draftDirtyRef.current = body.trim().length > 0
                      setDraft((current) => (current ? { ...current, body } : current))
                    }}
                    onCancel={cancelDraft}
                    onSubmit={async (body) => {
                      const { excerpt, texSource } = await draft.details
                      const added = await onAddNote({
                        region: draft.region,
                        body,
                        selectedText: excerpt,
                        texSource
                      })
                      if (added) {
                        cancelDraft()
                      }
                      return added
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>,
            hostFor(draft.region.page),
            'draft'
          )
        : null}
    </>
  )
}

/** A saved note's region on its page, with a numbered badge that opens the note. */
function PdfNoteMark({
  note,
  index,
  style,
  active,
  owner,
  worktreeId,
  onActiveChange
}: {
  note: PdfNote
  index: number
  style: CSSProperties
  active: boolean
  owner: DiffCommentOwner | null
  worktreeId: string
  onActiveChange: (active: boolean) => void
}): JSX.Element {
  const t = useTranslate()
  return (
    <Popover open={active} onOpenChange={onActiveChange}>
      <div
        data-pdf-note-region={note.id}
        style={style}
        className={cn(
          'rounded-sm border border-dashed border-ring/60 bg-ring/5',
          active && 'border-solid border-ring bg-ring/10',
          note.sentAt && !active && 'border-muted-foreground/40 bg-transparent'
        )}
      >
        <PopoverAnchor asChild>
          <button
            type="button"
            data-pdf-note-ui=""
            data-pdf-note-badge={note.id}
            aria-label={t('auto.components.editor.PdfViewer.openNote', 'Open note {{index}}', {
              index: index + 1
            })}
            aria-expanded={active}
            className={cn(
              'pointer-events-auto absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full text-3xs font-semibold tabular-nums shadow-xs',
              note.sentAt ? 'bg-muted-foreground text-background' : 'bg-foreground text-background'
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onActiveChange(!active)}
          >
            {index + 1}
          </button>
        </PopoverAnchor>
      </div>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-80"
        data-pdf-note-ui=""
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="p-1">
          <DiffCommentCard
            lineNumber={note.lineNumber}
            label={getDiffCommentLineMetaLabel(note, t)}
            quote={formatMarkdownReviewCardQuote(note.selectedText)}
            body={note.body}
            sentAt={note.sentAt}
            onDelete={
              owner
                ? () => {
                    onActiveChange(false)
                    void useAppStore.getState().deleteDiffComment(owner, note.id)
                  }
                : undefined
            }
            onSubmitEdit={
              owner
                ? (body) => useAppStore.getState().updateDiffComment(owner, note.id, body)
                : undefined
            }
            headerActions={
              <NotesSendMenu
                owner={owner}
                worktreeId={worktreeId}
                groupId={worktreeId}
                modeIdParts={['pdf-notes', worktreeId, note.filePath, note.id]}
                scopes={[
                  {
                    id: 'note',
                    label: t('auto.components.editor.MarkdownPreview.f37b98999e', 'This note'),
                    notes: note.sentAt ? [] : [note],
                    formatPrompt: formatDiffComments
                  }
                ]}
                targetModeLabel={t('auto.components.editor.NotesSendMenu.thisNote', 'This note')}
                triggerClassName="orca-diff-comment-pill-btn"
                disabledTooltip={t(
                  'auto.components.editor.NotesSendMenu.noteAlreadySent',
                  'Note already sent'
                )}
                onDelivered={(delivered) =>
                  void (
                    owner && useAppStore.getState().clearDeliveredDiffComments(owner, delivered)
                  )
                }
              />
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
