import { type RefObject, useEffect, useRef, useState } from 'react'
import type { PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { SynctexRect } from './pdf-synctex-parser'
import {
  pagePixelsAt,
  pagePixelsToPdfRect,
  pdfPageGeometry,
  type PdfPageGeometry
} from './pdf-page-geometry'

// Why: a click or a shaky press is not a region.
const MIN_REGION_PX = 6

export type PdfNoteDrag = {
  page: number
  box: { left: number; top: number; width: number; height: number }
}

/**
 * While `enabled`, a drag over a page marks a region on it: the box under way is returned, and
 * the finished one is reported in PDF points. The container carries `data-pdf-annotating` so
 * page text and links stop taking the pointer.
 */
export function usePdfNoteDrag({
  viewer,
  containerRef,
  enabled,
  canStart,
  onStart,
  onRegion
}: {
  viewer: InstanceType<typeof PdfJsViewer>
  containerRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  canStart: () => boolean
  onStart: () => void
  onRegion: (region: SynctexRect) => void
}): PdfNoteDrag | null {
  const [drag, setDrag] = useState<PdfNoteDrag | null>(null)
  const callbacks = useRef({ canStart, onStart, onRegion })
  callbacks.current = { canStart, onStart, onRegion }

  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) {
      return
    }
    container.setAttribute('data-pdf-annotating', '')
    let active: {
      page: PdfPageGeometry
      pageNumber: number
      start: { x: number; y: number }
      box: PdfNoteDrag['box']
    } | null = null
    const boxTo = (clientX: number, clientY: number): PdfNoteDrag['box'] | null => {
      if (!active) {
        return null
      }
      const { page, start } = active
      const at = pagePixelsAt(page, clientX, clientY)
      const x = Math.min(Math.max(at.x, 0), page.div.clientWidth)
      const y = Math.min(Math.max(at.y, 0), page.div.clientHeight)
      return {
        left: Math.min(start.x, x),
        top: Math.min(start.y, y),
        width: Math.abs(x - start.x),
        height: Math.abs(y - start.y)
      }
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || !(event.target instanceof Element)) {
        return
      }
      if (event.target.closest('[data-pdf-note-ui]') || !callbacks.current.canStart()) {
        return
      }
      const pageElement = event.target.closest('.page')
      const pageNumber = Number(pageElement?.getAttribute('data-page-number'))
      if (!pageElement || !container.contains(pageElement) || !Number.isInteger(pageNumber)) {
        return
      }
      const page = pdfPageGeometry(viewer, pageNumber)
      if (!page) {
        return
      }
      event.preventDefault()
      callbacks.current.onStart()
      const start = pagePixelsAt(page, event.clientX, event.clientY)
      active = {
        page,
        pageNumber,
        start,
        box: { left: start.x, top: start.y, width: 0, height: 0 }
      }
      setDrag({ page: pageNumber, box: active.box })
    }
    const onPointerMove = (event: PointerEvent): void => {
      const box = boxTo(event.clientX, event.clientY)
      if (active && box) {
        active.box = box
        setDrag({ page: active.pageNumber, box })
      }
    }
    const finish = (commit: boolean): void => {
      const done = active
      active = null
      if (!done) {
        return
      }
      setDrag(null)
      const { box } = done
      if (commit && box.width >= MIN_REGION_PX && box.height >= MIN_REGION_PX) {
        callbacks.current.onRegion(pagePixelsToPdfRect(done.page, done.pageNumber, box))
      }
    }
    const onPointerUp = (): void => finish(true)
    const onPointerCancel = (): void => finish(false)
    container.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      container.removeAttribute('data-pdf-annotating')
      container.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      setDrag(null)
    }
  }, [containerRef, enabled, viewer])

  return drag
}
