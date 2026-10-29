/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: PDF loading drives pdf.js document/viewer instances and decode errors through an external worker lifecycle. */
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
import { useAppStore } from '@/store'
import { usePdfViewerFindShortcut } from './use-pdf-viewer-find-shortcut'

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { translate } from '@/i18n/i18n'
import {
  createPdfDocumentLoader,
  type PdfDocumentLoader,
  type PdfLoadError
} from './pdf-document-loader'
import { createPdfViewerSession } from './pdf-viewer-session'
import { pdfViewPositionStore } from './pdf-view-position-storage'
import { PdfToolbar } from './PdfToolbar'
import {
  PdfSidebar,
  readPdfSidebarPreference,
  writePdfSidebarPreference,
  type PdfSidebarPreference
} from './PdfSidebar'
import {
  applyPdfScalePreference,
  stepPdfScalePreference,
  type PdfScalePreference
} from './pdf-scale-preference'
import { readPdfScalePreference, writePdfScalePreference } from './pdf-scale-preference-storage'
import { EditorCommandOwnerContext } from './editor-command-owner-context'
import { listenForViewerZoomRequests } from './viewer-zoom-request'
import type { SynctexRect } from './pdf-synctex-parser'
import {
  openPdfSynctexSource,
  PDF_SYNCTEX_REVEAL_EVENT,
  takePendingPdfSynctexReveal
} from './pdf-synctex-navigation'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const MIN_SCALE = 0.25
const MAX_SCALE = 5
const SCALE_STEP = 1.25
const SCALE_BOUNDS = { min: MIN_SCALE, max: MAX_SCALE, step: SCALE_STEP }

type PdfViewerProps = {
  content: string
  filePath: string
  // Why: callers that do not have an owner identity (for example diff and
  // conflict panes) must not persist a preference under a path-only key.
  preferenceKey?: string | null
  // Why: absent means "no scroll memory" — the diff and conflict-review callers
  // mount several viewers on one path, so a shared key would cross-write.
  scrollCacheKey?: string | null
  // Why: only an editor tab's own viewer navigates SyncTeX; diff and conflict panes pass nothing.
  synctexFileId?: string
}

export default function PdfViewer(props: PdfViewerProps): JSX.Element {
  const identity = JSON.stringify([
    props.filePath,
    props.preferenceKey ?? null,
    props.scrollCacheKey ?? null
  ])
  return <PdfDocumentViewer key={identity} {...props} />
}

function PdfDocumentViewer({
  content,
  filePath,
  preferenceKey = null,
  scrollCacheKey = null,
  synctexFileId
}: PdfViewerProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerDivRef = useRef<HTMLDivElement>(null)
  const loaderRef = useRef<PdfDocumentLoader | null>(null)
  const [pdfError, setPdfError] = useState<PdfLoadError | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [scale, setScale] = useState(1)
  const [page, setPage] = useState<{ number: number; count: number } | null>(null)
  const [shown, setShown] = useState<{
    doc: pdfjsLib.PDFDocumentProxy
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
  // Why: content reloads rebuild the pdf.js viewer; keep zoom across updates of
  // the same file and restore the durable preference after a remount or restart.
  const scalePreferenceRef = useRef<PdfScalePreference>('page-width')

  const filename = useMemo(() => filePath.split(/[/\\]/).pop() || filePath, [filePath])
  const cleanedContent = useMemo(() => content.replace(/\s/g, ''), [content])

  // Why: every zoom entry point (toolbar, app zoom command, wheel/pinch) must record the
  // scale preference so the next content reload restores it (see scalePreferenceRef).
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
        const session = createPdfViewerSession({
          container,
          viewerDiv,
          doc,
          positions: pdfViewPositionStore(scrollCacheKey, preferenceKey),
          scalePreference: scalePreferenceRef.current,
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
        }
      }
    })
    loaderRef.current = loader
    return () => {
      loaderRef.current = null
      loader.dispose()
    }
  }, [filePath, preferenceKey, recordScalePreference, scrollCacheKey])

  useEffect(() => {
    loaderRef.current?.load(cleanedContent)
    // Why: owner changes must load again even when the bytes are identical.
  }, [cleanedContent, filePath, preferenceKey, scrollCacheKey])

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

  useEffect(() => {
    if (!shown || !synctexFileId) {
      return
    }
    const reveal = (): void => {
      const rect = takePendingPdfSynctexReveal(synctexFileId)
      if (rect) {
        shown.revealRect(rect)
      }
    }
    reveal()
    const onRequest = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail?.fileId === synctexFileId) {
        reveal()
      }
    }
    window.addEventListener(PDF_SYNCTEX_REVEAL_EVENT, onRequest)
    return () => window.removeEventListener(PDF_SYNCTEX_REVEAL_EVENT, onRequest)
  }, [shown, synctexFileId])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !shown || !synctexFileId) {
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
      void openPdfSynctexSource(synctexFileId, point)
    }
    container.addEventListener('click', onClick, { capture: true })
    return () => container.removeEventListener('click', onClick, { capture: true })
  }, [shown, synctexFileId])

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
          {/* Why: PDFViewer requires its container to be position:absolute.
            The outer div uses all:revert to prevent Tailwind Preflight from
            cascading into pdf.js DOM (text layer misalignment). The inner div
            carries positioning and background since all:revert nullifies classes. */}
          <div style={{ all: 'revert' }}>
            <div
              ref={containerRef}
              style={{
                position: 'absolute',
                inset: '0',
                overflow: 'auto',
                background: 'var(--muted)'
              }}
              className="scrollbar-editor"
            >
              <div ref={viewerDivRef} className="pdfViewer" />
            </div>
          </div>
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
                {translate(
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
      />
    </div>
  )
}
