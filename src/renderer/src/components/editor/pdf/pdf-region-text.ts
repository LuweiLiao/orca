import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { SynctexRect } from './pdf-synctex-parser'

const MAX_REGION_TEXT_LENGTH = 2000

type TextItem = Extract<
  Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'][number],
  { str: string }
>
type TextRun = { str: string; left: number; top: number; width: number; height: number }

/** A text item's string and box in PDF points from the page's top-left. */
function textRun(item: TextItem, viewBox: number[]): TextRun {
  const [, , c, d, e, f] = item.transform.map(Number)
  const height = item.height > 0 ? item.height : Math.hypot(c, d)
  return {
    str: item.str,
    left: e - viewBox[0],
    top: viewBox[3] - f - height,
    width: item.width,
    height
  }
}

/** The part of a run inside the region's columns, cut by character share since glyph widths are unknown. */
function clipRun(run: TextRun, rect: SynctexRect): string {
  if (run.width <= 0 || run.str.length === 0) {
    return run.str
  }
  const chars = Array.from(run.str)
  const from = Math.max(0, (rect.left - run.left) / run.width)
  const to = Math.min(1, (rect.left + rect.width - run.left) / run.width)
  if (to <= from) {
    return ''
  }
  return chars.slice(Math.floor(from * chars.length), Math.ceil(to * chars.length)).join('')
}

/** The text pdf.js finds inside a region of a page, in reading order, for a note's excerpt. */
export async function readPdfRegionText(doc: PDFDocumentProxy, rect: SynctexRect): Promise<string> {
  const page = await doc.getPage(rect.page)
  const content = await page.getTextContent()
  const lines: string[] = []
  let line = ''
  let lineTop: number | null = null
  for (const item of content.items) {
    // Marked-content items carry no text.
    if (!('str' in item)) {
      continue
    }
    const run = textRun(item, page.view)
    const middle = run.top + run.height / 2
    const inside =
      middle >= rect.top &&
      middle <= rect.top + rect.height &&
      run.left < rect.left + rect.width &&
      run.left + run.width > rect.left
    if (inside) {
      // Why compare tops: pdf.js only flags some line ends, and a new baseline starts a new line.
      if (lineTop !== null && Math.abs(run.top - lineTop) > run.height / 2 && line) {
        lines.push(line)
        line = ''
      }
      line += clipRun(run, rect)
      lineTop = run.top
    }
    if (item.hasEOL && line) {
      lines.push(line)
      line = ''
      lineTop = null
    }
  }
  if (line) {
    lines.push(line)
  }
  const text = lines
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join('\n')
  return text.length > MAX_REGION_TEXT_LENGTH ? `${text.slice(0, MAX_REGION_TEXT_LENGTH)}…` : text
}
