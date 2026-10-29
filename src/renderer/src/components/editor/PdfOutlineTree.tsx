import { type JSX, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type * as pdfjsLib from 'pdfjs-dist'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  currentPdfOutlineRow,
  flattenPdfOutline,
  pdfOutlineAncestors,
  visiblePdfOutlineRows,
  type PdfOutlineNode,
  type PdfOutlineRow
} from './pdf-outline-model'

/** The page a destination lands on, or null when the PDF cannot say. */
async function destinationPage(
  doc: pdfjsLib.PDFDocumentProxy,
  dest: string | unknown[] | null
): Promise<number | null> {
  try {
    const explicit: unknown[] | null =
      typeof dest === 'string' ? await doc.getDestination(dest) : dest
    const ref: unknown = explicit?.[0]
    if (typeof ref === 'number') {
      return ref + 1
    }
    const num: unknown = typeof ref === 'object' && ref !== null ? Reflect.get(ref, 'num') : null
    const gen: unknown = typeof ref === 'object' && ref !== null ? Reflect.get(ref, 'gen') : null
    if (typeof num === 'number' && typeof gen === 'number') {
      return (await doc.getPageIndex({ num, gen })) + 1
    }
  } catch {
    // A broken destination only loses its "current section" mark.
  }
  return null
}

/** pdf.js's outline nodes, read field by field so a reshaped upgrade degrades to "no outline". */
function readOutlineNodes(value: unknown): PdfOutlineNode[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      return []
    }
    const title: unknown = Reflect.get(item, 'title')
    const dest: unknown = Reflect.get(item, 'dest')
    return [
      {
        title: typeof title === 'string' ? title : '',
        dest: typeof dest === 'string' || Array.isArray(dest) ? dest : null,
        items: readOutlineNodes(Reflect.get(item, 'items'))
      }
    ]
  })
}

/** The outline's rows, and the page each one starts on once pdf.js has resolved it. */
export function usePdfOutline(doc: pdfjsLib.PDFDocumentProxy | null): {
  rows: PdfOutlineRow[] | null
  pageOf: ReadonlyMap<string, number>
} {
  const [state, setState] = useState<{
    doc: pdfjsLib.PDFDocumentProxy | null
    rows: PdfOutlineRow[] | null
    pageOf: Map<string, number>
  }>({ doc: null, rows: null, pageOf: new Map() })
  useEffect(() => {
    if (!doc) {
      return
    }
    let cancelled = false
    void (async () => {
      let nodes: PdfOutlineNode[] = []
      try {
        nodes = readOutlineNodes(await doc.getOutline())
      } catch {
        nodes = []
      }
      const rows = flattenPdfOutline(nodes)
      if (cancelled) {
        return
      }
      setState({ doc, rows, pageOf: new Map() })
      const pageOf = new Map<string, number>()
      for (const row of rows) {
        const page = await destinationPage(doc, row.dest)
        if (cancelled) {
          return
        }
        if (page !== null) {
          pageOf.set(row.id, page)
        }
      }
      setState({ doc, rows, pageOf })
    })()
    return () => {
      cancelled = true
    }
  }, [doc])
  return state.doc === doc ? state : { rows: null, pageOf: new Map() }
}

export function PdfOutlineTree({
  rows,
  pageOf,
  currentPage,
  onNavigate
}: {
  rows: readonly PdfOutlineRow[]
  pageOf: ReadonlyMap<string, number>
  currentPage: number
  onNavigate: (dest: string | unknown[]) => void
}): JSX.Element {
  const [picked, setPicked] = useState<string | null>(null)
  const current = currentPdfOutlineRow(rows, pageOf, currentPage, picked)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [unfoldedFor, setUnfoldedFor] = useState<string | null>(null)
  // Why: the section the reader moves into unfolds once, so its mark is not hidden in a fold,
  // yet the reader can still fold it away afterwards.
  if (current !== unfoldedFor) {
    setUnfoldedFor(current)
    if (current) {
      setExpanded((prev) => new Set([...prev, ...pdfOutlineAncestors(current)]))
    }
  }
  const visible = visiblePdfOutlineRows(rows, expanded)
  if (rows.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        {translate('auto.components.editor.PdfViewer.noOutline', 'This PDF has no outline.')}
      </p>
    )
  }
  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  return (
    <ul role="tree" className="py-1 text-[13px]" data-pdf-outline="">
      {visible.map((row) => {
        const open = expanded.has(row.id)
        const page = pageOf.get(row.id)
        return (
          <li
            key={row.id}
            role="treeitem"
            aria-expanded={row.hasChildren ? open : undefined}
            aria-current={row.id === current ? 'location' : undefined}
            data-current={row.id === current || undefined}
            className={cn(
              'flex items-center gap-0.5 pr-2 hover:bg-accent',
              row.id === current && 'bg-accent text-foreground'
            )}
            style={{ paddingLeft: 4 + row.depth * 12 }}
          >
            {row.hasChildren ? (
              <button
                type="button"
                aria-label={
                  open
                    ? translate('auto.components.editor.PdfViewer.collapseSection', 'Collapse')
                    : translate('auto.components.editor.PdfViewer.expandSection', 'Expand')
                }
                onClick={() => toggle(row.id)}
                className="grid size-5 shrink-0 place-items-center text-muted-foreground"
              >
                <ChevronRight
                  className={cn('size-3.5 transition-transform', open && 'rotate-90')}
                />
              </button>
            ) : (
              <span className="size-5 shrink-0" />
            )}
            <button
              type="button"
              disabled={row.dest === null}
              title={row.title}
              onClick={() => {
                if (row.dest !== null) {
                  setPicked(row.id)
                  onNavigate(row.dest)
                }
              }}
              className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left disabled:text-muted-foreground"
            >
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
              {page !== undefined ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{page}</span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
