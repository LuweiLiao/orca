import type { PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { SynctexRect } from './pdf-synctex-parser'
import { pagePixelsToPdfRect, pdfPageGeometry } from './pdf-page-geometry'

const MAX_SELECTION_TEXT_LENGTH = 2000

export type PdfTextSelection = { text: string; range: Range; region: SynctexRect }

/**
 * The text selected in a PDF page's text layer and the box around it, in the same PDF points a
 * dragged region uses. Null for a selection that is empty or spans pages.
 */
export function readPdfTextSelection(
  viewer: InstanceType<typeof PdfJsViewer>,
  container: HTMLElement
): PdfTextSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }
  const range = selection.getRangeAt(0)
  const startPage = pageOf(range.startContainer, container)
  // Why the end's page too: a selection dragged onto the next page has no single region.
  if (!startPage || startPage !== pageOf(range.endContainer, container)) {
    return null
  }
  const text = selection.toString().trim()
  const pageNumber = Number(startPage.getAttribute('data-page-number'))
  const page = Number.isInteger(pageNumber) ? pdfPageGeometry(viewer, pageNumber) : null
  if (!text || !page) {
    return null
  }
  const pageBox = page.div.getBoundingClientRect()
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const rect of range.getClientRects()) {
    if (rect.width === 0 || rect.height === 0) {
      continue
    }
    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    right = Math.max(right, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left)) {
    return null
  }
  const offsetX = pageBox.left + page.div.clientLeft
  const offsetY = pageBox.top + page.div.clientTop
  const region = pagePixelsToPdfRect(page, pageNumber, {
    left: left - offsetX,
    top: top - offsetY,
    width: right - left,
    height: bottom - top
  })
  return {
    text:
      text.length > MAX_SELECTION_TEXT_LENGTH
        ? `${text.slice(0, MAX_SELECTION_TEXT_LENGTH)}…`
        : text,
    range,
    region
  }
}

/** The page whose text layer holds `node`; text elsewhere (a form field, the sidebar) is not page text. */
function pageOf(node: Node, container: HTMLElement): Element | null {
  const element = node instanceof Element ? node : node.parentElement
  const page = element?.closest('.textLayer')?.closest('.page') ?? null
  return page && container.contains(page) ? page : null
}
