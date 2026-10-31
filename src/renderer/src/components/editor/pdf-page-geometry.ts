import type { EventBus, PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { SynctexRect } from './pdf-synctex-parser'

const FLASH_MS = 1800

export type PdfPageGeometry = {
  div: HTMLElement
  toPdf: (x: number, y: number) => [number, number]
  toViewport: (x: number, y: number) => [number, number]
}

/** pdf.js's page view for a page, read field by field since its typings are `any`. */
export function pdfPageGeometry(
  viewer: InstanceType<typeof PdfJsViewer>,
  pageNumber: number
): PdfPageGeometry | null {
  const view: unknown = viewer.getPageView(pageNumber - 1)
  if (typeof view !== 'object' || view === null) {
    return null
  }
  const div: unknown = Reflect.get(view, 'div')
  const viewport: unknown = Reflect.get(view, 'viewport')
  if (!(div instanceof HTMLElement) || typeof viewport !== 'object' || viewport === null) {
    return null
  }
  const toPdfPoint: unknown = Reflect.get(viewport, 'convertToPdfPoint')
  const toViewportPoint: unknown = Reflect.get(viewport, 'convertToViewportPoint')
  if (typeof toPdfPoint !== 'function' || typeof toViewportPoint !== 'function') {
    return null
  }
  const pair = (value: unknown): [number, number] =>
    Array.isArray(value) ? [Number(value[0]), Number(value[1])] : [Number.NaN, Number.NaN]
  return {
    div,
    toPdf: (x, y) => pair(Reflect.apply(toPdfPoint, viewport, [x, y])),
    toViewport: (x, y) => pair(Reflect.apply(toViewportPoint, viewport, [x, y]))
  }
}

/**
 * Briefly marks a SyncTeX rect on its page, like an editor's reveal highlight. pdf.js empties a
 * page when it re-renders (a zoom, or a tab shown at a new width), so the mark is redrawn then.
 */
export function flashPdfRect(
  viewer: InstanceType<typeof PdfJsViewer>,
  eventBus: InstanceType<typeof EventBus>,
  rect: SynctexRect
): void {
  let marker: HTMLDivElement | null = null
  const draw = (): void => {
    const page = pdfPageGeometry(viewer, rect.page)
    if (!page) {
      return
    }
    const [pdfLeft, pdfTop] = page.toPdf(0, 0)
    const [x1, y1] = page.toViewport(pdfLeft + rect.left, pdfTop - rect.top)
    const [x2, y2] = page.toViewport(
      pdfLeft + rect.left + rect.width,
      pdfTop - rect.top - rect.height
    )
    marker?.remove()
    marker = document.createElement('div')
    marker.setAttribute('data-pdf-synctex-mark', '')
    Object.assign(marker.style, {
      position: 'absolute',
      left: `${Math.min(x1, x2)}px`,
      top: `${Math.min(y1, y2)}px`,
      width: `${Math.abs(x2 - x1)}px`,
      height: `${Math.abs(y2 - y1)}px`,
      background: 'color-mix(in srgb, var(--markdown-search-match) 45%, transparent)',
      borderRadius: '2px',
      pointerEvents: 'none',
      zIndex: '10',
      transition: 'opacity 400ms ease-out'
    })
    page.div.querySelector('[data-pdf-synctex-mark]')?.remove()
    page.div.append(marker)
  }
  const onRendered = (event: { pageNumber?: number }): void => {
    if (event.pageNumber === rect.page && !marker?.isConnected) {
      draw()
    }
  }
  draw()
  eventBus.on('pagerendered', onRendered)
  setTimeout(() => {
    eventBus.off('pagerendered', onRendered)
    const fading = marker
    if (fading) {
      fading.style.opacity = '0'
      setTimeout(() => fading.remove(), 400)
    }
  }, FLASH_MS)
}

/** The page under a pointer and its SyncTeX coordinates: PDF points from the top-left. */
export function pdfPointAt(
  viewer: InstanceType<typeof PdfJsViewer>,
  container: HTMLElement,
  event: MouseEvent
): { page: number; x: number; y: number } | null {
  const target = event.target instanceof Element ? event.target.closest('.page') : null
  const pageNumber = Number(target?.getAttribute('data-page-number'))
  if (!target || !container.contains(target) || !Number.isInteger(pageNumber)) {
    return null
  }
  const page = pdfPageGeometry(viewer, pageNumber)
  if (!page) {
    return null
  }
  const box = page.div.getBoundingClientRect()
  const [x, y] = page.toPdf(
    event.clientX - box.left - page.div.clientLeft,
    event.clientY - box.top - page.div.clientTop
  )
  // SyncTeX measures from the page's top-left; PDF space grows up from the bottom-left.
  const [pdfLeft, pdfTop] = page.toPdf(0, 0)
  return { page: pageNumber, x: x - pdfLeft, y: pdfTop - y }
}
