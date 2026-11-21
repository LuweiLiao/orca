import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { EventBus, PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { pdfPageGeometry } from './pdf-page-geometry'

// Why these: pdf.js empties a page's div when it re-renders or evicts it, and reports both here.
const REATTACH_EVENTS = ['pagerender', 'pagerendered', 'pagesinit', 'updateviewarea'] as const

/**
 * One overlay element per page in `pages`, kept inside that page's div so it scrolls and zooms with
 * the page. React portals render into them; they are put back each time pdf.js clears the page.
 */
export function usePdfPageHosts(
  viewer: InstanceType<typeof PdfJsViewer>,
  eventBus: InstanceType<typeof EventBus>,
  pages: readonly number[]
): (page: number) => HTMLDivElement {
  const hostsRef = useRef(new Map<number, HTMLDivElement>())
  const pagesKey = [...new Set(pages)].sort((a, b) => a - b).join(',')

  const hostFor = useCallback((page: number): HTMLDivElement => {
    let host = hostsRef.current.get(page)
    if (!host) {
      host = document.createElement('div')
      host.setAttribute('data-pdf-note-host', String(page))
      Object.assign(host.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '20'
      })
      hostsRef.current.set(page, host)
    }
    return host
  }, [])

  useLayoutEffect(() => {
    const wanted = new Set(pagesKey ? pagesKey.split(',').map(Number) : [])
    for (const [page, host] of hostsRef.current) {
      if (!wanted.has(page)) {
        host.remove()
        hostsRef.current.delete(page)
      }
    }
    const attach = (): void => {
      for (const [page, host] of hostsRef.current) {
        const div = pdfPageGeometry(viewer, page)?.div
        if (div && host.parentElement !== div) {
          div.append(host)
        }
      }
    }
    attach()
    for (const name of REATTACH_EVENTS) {
      eventBus.on(name, attach)
    }
    return () => {
      for (const name of REATTACH_EVENTS) {
        eventBus.off(name, attach)
      }
    }
  }, [eventBus, pagesKey, viewer])

  // Detach only: a remount (StrictMode, a new viewer) puts the same hosts back.
  useEffect(() => {
    const hosts = hostsRef.current
    return () => {
      for (const host of hosts.values()) {
        host.remove()
      }
    }
  }, [])

  return hostFor
}
