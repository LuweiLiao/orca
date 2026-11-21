import { type JSX, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, Image as ImageIcon } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import type {
  EventBus,
  PDFFindController,
  PDFViewer as PdfJsViewer
} from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import PdfFind from './PdfFind'
import { useAppStore } from '@/store/index'
import { usePdfViewerFindShortcut } from './use-pdf-viewer-find-shortcut'

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useTranslate } from '@/i18n/use-translate'
import {
  createPdfDocumentLoader,
  type PdfDocumentLoader,
  type PdfLoadError
} from './pdf-document-loader'
import { PdfToolbar } from './PdfToolbar'
import {
  PdfSidebar,
  readPdfSidebarPreference,
  writePdfSidebarPreference,
  type PdfSidebarPreference
} from './PdfSidebar'
import type { SynctexRect } from './pdf-synctex-parser'
import { openPdfSynctexSource } from './pdf-synctex-navigation'
import { PDF_REVEAL_EVENT, takePendingPdfReveal } from './pdf-reveal-request'
import { createPdfViewerSession } from './pdf-viewer-session'
import { usePdfFormEditing } from './use-pdf-form-editing'
import {
  applyPdfScalePreference,
  stepPdfScalePreference,
  type PdfScalePreference
} from './pdf-scale-preference'
import { readPdfScalePreference, writePdfScalePreference } from './pdf-scale-preference-storage'
import { EditorCommandOwnerContext } from '../commands/editor-command-owner-context'
import { listenForViewerZoomRequests } from '../viewer-viewport/viewer-zoom-request'
import { usePdfViewerNotes } from './use-pdf-viewer-notes'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const MIN_SCALE = 0.25
const MAX_SCALE = 5
const SCALE_STEP = 1.25
const SCALE_BOUNDS = { min: MIN_SCALE, max: MAX_SCALE, step: SCALE_STEP }

type PdfViewerProps = {
  /** Base64 bytes, for git blobs, diffs and the web client. */
  content: string
  /** An orca-media URL pdf.js reads by range; wins over `content`. */
  src?: string
  /** The file's size, which pdf.js needs to read `src` by range. */
  byteSize?: number
  filePath: string
  // Persist zoom only with owner-qualified identity; diff/conflict callers must not use a path-only key.
  preferenceKey?: string | null
  // Omit scroll memory for diff/conflict surfaces that can mount several viewers on the same path.
  scrollCacheKey?: string | null
  /** The writable tab whose form fields this viewer fills in; without it forms are read-only. */
  editFileId?: string | null
  // Only an editor tab's own viewer navigates SyncTeX and takes notes; diff and conflict panes pass nothing.
  editorFileId?: string
}

export default function PdfViewer(props: PdfViewerProps): JSX.Element {
  const identity = JSON.stringify([
    props.filePath,
    props.preferenceKey ?? null,
    props.scrollCacheKey ?? null,
    props.editFileId ?? null
  ])
  return <PdfDocumentViewer key={identity} {...props} />
}

function PdfDocumentViewer({
  content,
  src,
  byteSize,
  filePath,
  preferenceKey = null,
  scrollCacheKey = null,
  editFileId = null,
  editorFileId
}: PdfViewerProps): JSX.Element {
  const t = useTranslate()
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerDivRef = useRef<HTMLDivElement>(null)
  const loaderRef = useRef<PdfDocumentLoader | null>(null)
  const {
    attach: attachFormEditing,
    load: loadFormDocument,
    reset: resetFormEditing
  } = usePdfFormEditing(editFileId, rootRef, loaderRef)
  const [pdfError, setPdfError] = useState<PdfLoadError | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [scale, setScale] = useState(1)
  const [page, setPage] = useState<{ number: number; count: number } | null>(null)
  const [shown, setShown] = useState<{
    doc: pdfjsLib.PDFDocumentProxy
    viewer: InstanceType<typeof PdfJsViewer>
    eventBus: InstanceType<typeof EventBus>
    goToPage: (pageNumber: number) => void
    goToDestination: (dest: string | unknown[]) => void
    revealRect: (rect: SynctexRect) => void
    pointAt: (event: MouseEvent) => { page: number; x: number; y: number } | null
  } | null>(null)
  const [sidebar, setSidebar] = useState<PdfSidebarPreference>(() =>
    readPdfSidebarPreference(preferenceKey)
  )
  const updateSidebar = useCallback(
    (next: PdfSidebarPreference) => {
      setSidebar(next)
      writePdfSidebarPreference(preferenceKey, next)
    },
    [preferenceKey]
  )
  const keybindings = useAppStore((state) => state.keybindings)
  const isCommandOwner = useContext(EditorCommandOwnerContext)
  const eventBusRef = useRef<InstanceType<typeof EventBus> | null>(null)
  const findControllerRef = useRef<InstanceType<typeof PDFFindController> | null>(null)
  const pdfViewerRef = useRef<InstanceType<typeof PdfJsViewer> | null>(null)
  // Retain zoom through viewer rebuilds; durable preferences restore it after remount or restart.
  const scalePreferenceRef = useRef<PdfScalePreference>('page-width')

  const filename = useMemo(() => filePath.split(/[/\\]/).pop() || filePath, [filePath])
  const cleanedContent = useMemo(() => content.replace(/\s/g, ''), [content])

  // All zoom entry points must record preferences so content reloads restore the chosen scale.
  const recordScalePreference = useCallback(
    (preference: PdfScalePreference) => {
      scalePreferenceRef.current = preference
      if (preferenceKey) {
        writePdfScalePreference(preferenceKey, preference)
      }
    },
    [preferenceKey]
  )

  useEffect(() => {
    const container = containerRef.current
    const viewerDiv = viewerDivRef.current
    if (!container || !viewerDiv) {
      return
    }

    setPdfError(null)
    scalePreferenceRef.current = preferenceKey
      ? (readPdfScalePreference(preferenceKey) ?? 'page-width')
      : 'page-width'
    const loader = createPdfDocumentLoader({
      onError: setPdfError,
      display: (doc) => {
        const formDraft = attachFormEditing(doc)
        const session = createPdfViewerSession({
          container,
          viewerDiv,
          doc,
          scrollCacheKey,
          formsEditable: formDraft !== null,
          getScalePreference: () => scalePreferenceRef.current,
          scaleBounds: SCALE_BOUNDS,
          onScaleChanging: setScale,
          onPageChanging: setPage,
          onWheelZoom: recordScalePreference
        })
        eventBusRef.current = session.eventBus
        findControllerRef.current = session.findController
        pdfViewerRef.current = session.viewer
        setShown({
          doc,
          viewer: session.viewer,
          eventBus: session.eventBus,
          goToPage: session.goToPage,
          goToDestination: session.goToDestination,
          revealRect: session.revealRect,
          pointAt: session.pointAt
        })
        return () => {
          try {
            session.dispose()
          } finally {
            eventBusRef.current = null
            findControllerRef.current = null
            pdfViewerRef.current = null
            setShown(null)
            setFindOpen(false)
          }
          return formDraft?.detach()
        }
      }
    })
    loaderRef.current = loader
    return () => {
      loaderRef.current = null
      resetFormEditing()
      loader.dispose()
    }
  }, [
    attachFormEditing,
    filePath,
    preferenceKey,
    recordScalePreference,
    resetFormEditing,
    scrollCacheKey
  ])

  useEffect(() => {
    loadFormDocument(src ? { url: src, length: byteSize } : { base64: cleanedContent })
    // Identical bytes still require reload when ownership changes.
  }, [byteSize, cleanedContent, filePath, loadFormDocument, preferenceKey, scrollCacheKey, src])

  const closeFindBar = useCallback(() => {
    const eventBus = eventBusRef.current
    if (eventBus) {
      eventBus.dispatch('findbarclose', { source: null })
    }
    setFindOpen(false)
  }, [])

  const stepZoom = useCallback(
    (direction: 'in' | 'out') => {
      const viewer = pdfViewerRef.current
      if (!viewer) {
        return
      }
      const next = stepPdfScalePreference(viewer.currentScale, direction, SCALE_BOUNDS)
      viewer.currentScale = next.scale
      recordScalePreference(next.preference)
    },
    [recordScalePreference]
  )

  const applyScalePreference = useCallback(
    (preference: PdfScalePreference) => {
      const viewer = pdfViewerRef.current
      if (!viewer) {
        return
      }
      applyPdfScalePreference(viewer, preference, SCALE_BOUNDS)
      recordScalePreference(preference)
    },
    [recordScalePreference]
  )
  const zoomReset = useCallback(() => applyScalePreference('page-width'), [applyScalePreference])

  useEffect(() => {
    if (!isCommandOwner) {
      return
    }
    return listenForViewerZoomRequests(
      (direction) => (direction === 'reset' ? zoomReset() : stepZoom(direction)),
      rootRef
    )
  }, [isCommandOwner, stepZoom, zoomReset])

  const openFind = useCallback(() => setFindOpen(true), [])
  usePdfViewerFindShortcut({ rootRef, ownsCommands: isCommandOwner, keybindings, openFind })

  const goToPage = useCallback((pageNumber: number) => shown?.goToPage(pageNumber), [shown])

  const notes = usePdfViewerNotes({ editorFileId, filePath, containerRef, shown })

  useEffect(() => {
    if (!shown || !editorFileId) {
      return
    }
    const reveal = (): void => {
      const rect = takePendingPdfReveal(editorFileId)
      if (rect) {
        shown.revealRect(rect)
      }
    }
    reveal()
    const onRequest = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail?.fileId === editorFileId) {
        reveal()
      }
    }
    window.addEventListener(PDF_REVEAL_EVENT, onRequest)
    return () => window.removeEventListener(PDF_REVEAL_EVENT, onRequest)
  }, [shown, editorFileId])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !shown || !editorFileId) {
      return
    }
    const isMac = navigator.userAgent.includes('Mac')
    // Why capture: a Ctrl/Cmd-click on a link annotation must jump to source, not follow it.
    const onClick = (event: MouseEvent): void => {
      if (!(isMac ? event.metaKey : event.ctrlKey) || event.button !== 0) {
        return
      }
      const point = shown.pointAt(event)
      if (!point) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      void openPdfSynctexSource(editorFileId, point)
    }
    container.addEventListener('click', onClick, { capture: true })
    return () => container.removeEventListener('click', onClick, { capture: true })
  }, [shown, editorFileId])

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        {sidebar.open && shown ? (
          <PdfSidebar
            key={preferenceKey ?? filePath}
            doc={shown.doc}
            currentPage={page?.number ?? 1}
            tab={sidebar.tab}
            onTabChange={(tab) => updateSidebar({ ...sidebar, tab })}
            onGoToPage={shown.goToPage}
            onGoToDestination={shown.goToDestination}
          />
        ) : null}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <PdfFind isOpen={findOpen} onClose={closeFindBar} eventBusRef={eventBusRef} />
          {/* PDFViewer needs absolute positioning; isolate pdf.js DOM from Preflight with all:revert, then apply layout on the inner container. */}
          <div style={{ all: 'revert' }}>
            <div
              ref={containerRef}
              style={{
                position: 'absolute',
                inset: '0',
                overflow: 'auto',
                background: 'var(--pdf-viewer-bg, #e4e4e7)'
              }}
              className="scrollbar-editor dark:[--pdf-viewer-bg:#18181b]"
            >
              <div ref={viewerDivRef} className="pdfViewer" />
            </div>
          </div>
          {notes.layer}
          {pdfError && !pdfError.stale ? (
            <div
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-8 text-sm text-muted-foreground"
            >
              <ImageIcon size={40} />
              <div>{pdfError.message}</div>
              <div className="max-w-md break-all text-center text-xs">{filename}</div>
            </div>
          ) : null}
          {pdfError?.stale ? (
            <div
              role="status"
              data-pdf-stale-notice=""
              className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-1.5 text-xs text-muted-foreground"
            >
              <CircleAlert className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {t(
                  'auto.components.editor.PdfViewer.staleVersion',
                  'The latest version could not be loaded; showing the last one that did.'
                )}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <PdfToolbar
        sidebarOpen={sidebar.open}
        onToggleSidebar={() => updateSidebar({ ...sidebar, open: !sidebar.open })}
        filename={filename}
        scale={scale}
        scaleBounds={SCALE_BOUNDS}
        page={page}
        onZoom={stepZoom}
        onScalePreference={applyScalePreference}
        onGoToPage={goToPage}
        onFind={openFind}
        notesControls={notes.toolbar}
      />
    </div>
  )
}
