import { type JSX, useEffect, useRef, useState } from 'react'
import type * as pdfjsLib from 'pdfjs-dist'
import { useVirtualizer } from '@tanstack/react-virtual'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

const THUMBNAIL_WIDTH = 112
const ROW_GAP = 28
// Why: only the rows in view hold a canvas; a few above and below keep scrolling smooth.
const OVERSCAN = 3

/** Page thumbnails, windowed so a long PDF never holds a canvas per page. */
export function PdfThumbnails({
  doc,
  currentPage,
  onNavigate
}: {
  doc: pdfjsLib.PDFDocumentProxy
  currentPage: number
  onNavigate: (pageNumber: number) => void
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [aspect, setAspect] = useState(1.3)
  useEffect(() => {
    let cancelled = false
    void doc
      .getPage(1)
      .then((page) => {
        const viewport = page.getViewport({ scale: 1 })
        if (!cancelled && viewport.width > 0) {
          setAspect(viewport.height / viewport.width)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [doc])
  const rowHeight = Math.round(THUMBNAIL_WIDTH * aspect) + ROW_GAP
  const virtualizer = useVirtualizer({
    count: doc.numPages,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN
  })
  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])
  // Why: the strip follows the reader, but only when the current page has left its view.
  useEffect(() => {
    virtualizer.scrollToIndex(currentPage - 1, { align: 'auto' })
  }, [currentPage, virtualizer])
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto scrollbar-sleek" data-pdf-thumbnails="">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const pageNumber = item.index + 1
          const current = pageNumber === currentPage
          return (
            <button
              key={item.key}
              type="button"
              data-pdf-thumbnail={pageNumber}
              data-current={current || undefined}
              aria-current={current ? 'page' : undefined}
              aria-label={translate('auto.components.editor.PdfViewer.goToPage', 'Page {{page}}', {
                page: pageNumber
              })}
              onClick={() => onNavigate(pageNumber)}
              className="absolute inset-x-0 flex flex-col items-center gap-1 pt-2 text-xs text-muted-foreground"
              style={{ top: item.start, height: item.size }}
            >
              <PdfThumbnailCanvas
                doc={doc}
                pageNumber={pageNumber}
                className={cn(
                  'rounded-sm bg-background shadow-xs ring-1 ring-border',
                  current && 'ring-2 ring-ring'
                )}
              />
              <span className={cn('tabular-nums', current && 'text-foreground')}>{pageNumber}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PdfThumbnailCanvas({
  doc,
  pageNumber,
  className
}: {
  doc: pdfjsLib.PDFDocumentProxy
  pageNumber: number
  className: string
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    let cancelled = false
    let task: ReturnType<pdfjsLib.PDFPageProxy['render']> | null = null
    void doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) {
          return
        }
        const unscaled = page.getViewport({ scale: 1 })
        const ratio = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: (THUMBNAIL_WIDTH / unscaled.width) * ratio })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`
        task = page.render({ canvas, viewport })
        return task.promise
      })
      .catch(() => {
        // A cancelled or failed thumbnail stays blank; the page itself still reads fine.
      })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNumber])
  return <canvas ref={canvasRef} className={className} style={{ width: THUMBNAIL_WIDTH }} />
}
