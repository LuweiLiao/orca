/** One bookmark of a PDF's outline, as pdf.js `getOutline` returns it (only the fields used here). */
export type PdfOutlineNode = {
  title: string
  dest: string | unknown[] | null
  items: PdfOutlineNode[]
}

/** A bookmark flattened into a row: `parentId` folds it under its parent, `id` is its path. */
export type PdfOutlineRow = {
  id: string
  parentId: string | null
  depth: number
  title: string
  dest: string | unknown[] | null
  hasChildren: boolean
}

// Why: outlines carry stray control characters and line breaks from the authoring tool.
// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g

function cleanOutlineTitle(title: string): string {
  return title.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim()
}

export function flattenPdfOutline(nodes: readonly PdfOutlineNode[]): PdfOutlineRow[] {
  const rows: PdfOutlineRow[] = []
  const walk = (level: readonly PdfOutlineNode[], parentId: string | null, depth: number): void => {
    level.forEach((node, index) => {
      const id = parentId === null ? String(index) : `${parentId}.${index}`
      const children = Array.isArray(node.items) ? node.items : []
      rows.push({
        id,
        parentId,
        depth,
        title: cleanOutlineTitle(node.title ?? ''),
        dest: node.dest ?? null,
        hasChildren: children.length > 0
      })
      walk(children, id, depth + 1)
    })
  }
  walk(nodes, null, 0)
  return rows
}

/** Rows whose every ancestor is expanded. */
export function visiblePdfOutlineRows(
  rows: readonly PdfOutlineRow[],
  expanded: ReadonlySet<string>
): PdfOutlineRow[] {
  const hidden = new Set<string>()
  return rows.filter((row) => {
    if (row.parentId !== null && (hidden.has(row.parentId) || !expanded.has(row.parentId))) {
      hidden.add(row.id)
      return false
    }
    return true
  })
}

/** Ids of every ancestor of a row, so the reader's current section can be unfolded. */
export function pdfOutlineAncestors(rowId: string): string[] {
  const parts = rowId.split('.')
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('.'))
}

/**
 * The section the reader is in: the last bookmark, in document order, that starts on or before
 * the current page. Bookmarks whose page is unknown are skipped. A bookmark the reader picked wins
 * while they stay on its page, since several sections can start on one page.
 */
export function currentPdfOutlineRow(
  rows: readonly PdfOutlineRow[],
  pageOf: ReadonlyMap<string, number>,
  currentPage: number,
  picked: string | null = null
): string | null {
  if (picked !== null && pageOf.get(picked) === currentPage) {
    return picked
  }
  let current: string | null = null
  let best = 0
  for (const row of rows) {
    const page = pageOf.get(row.id)
    if (page !== undefined && page <= currentPage && page >= best) {
      current = row.id
      best = page
    }
  }
  return current
}
