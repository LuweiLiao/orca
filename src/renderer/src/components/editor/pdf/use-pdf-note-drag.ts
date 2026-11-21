import { type RefObject, useEffect, useRef, useState } from 'react'
import type { PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { SynctexRect } from './pdf-synctex-parser'
import { pagePixelsAt, pagePixelsToPdfRect, pdfPageGeometry } from './pdf-page-geometry'

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
    let stopDrag: (() => void) | null = null
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
      const boxTo = (clientX: number, clientY: number): PdfNoteDrag['box'] => {
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
      let box = boxTo(event.clientX, event.clientY)
      setDrag({ page: pageNumber, box })
      const onMove = (moveEvent: PointerEvent): void => {
        box = boxTo(moveEvent.clientX, moveEvent.clientY)
        setDrag({ page: pageNumber, box })
      }
      const finish = (commit: boolean): void => {
        stopDrag?.()
        setDrag(null)
        if (commit && box.width >= MIN_REGION_PX && box.height >= MIN_REGION_PX) {
          callbacks.current.onRegion(pagePixelsToPdfRect(page, pageNumber, box))
        }
      }
      const onUp = (): void => finish(true)
      const onCancel = (): void => finish(false)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      stopDrag = () => {
        stopDrag = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
    }
    container.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      container.removeAttribute('data-pdf-annotating')
      container.removeEventListener('pointerdown', onPointerDown, { capture: true })
      stopDrag?.()
      setDrag(null)
    }
  }, [containerRef, enabled, viewer])

  return drag
}
