import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { EventBus, PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { pdfPageGeometry } from './pdf-page-geometry'

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
    // Why these: pdf.js empties a page's div when it re-renders or evicts it, and reports both here.
    eventBus.on('pagerender', attach)
    eventBus.on('pagerendered', attach)
    eventBus.on('pagesinit', attach)
    eventBus.on('updateviewarea', attach)
    return () => {
      eventBus.off('pagerender', attach)
      eventBus.off('pagerendered', attach)
      eventBus.off('pagesinit', attach)
      eventBus.off('updateviewarea', attach)
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
