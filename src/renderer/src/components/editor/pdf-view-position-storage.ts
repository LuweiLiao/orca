import { pdfViewPositionCache, setWithLRU, type PdfViewPosition } from '@/lib/scroll-cache'
import { readFileViewPreference, writeFileViewPreference } from './file-view-preference-storage'
import { readPdfViewPosition } from './pdf-view-position'

export const PDF_VIEW_POSITIONS_STORAGE_KEY = 'orca.pdf.view-positions.v1'

export type PdfViewPositionStore = {
  read: () => PdfViewPosition | null
  write: (position: PdfViewPosition) => void
}

/**
 * Where a PDF's reading position lives: the tab's in-memory slot first, then this desktop's
 * durable record of the file, so a restart reopens on the same page. Without a tab key nothing
 * is kept; without a file key the position lasts only as long as the app is open.
 */
export function pdfViewPositionStore(
  scrollCacheKey: string | null,
  preferenceKey: string | null
): PdfViewPositionStore | null {
  if (!scrollCacheKey) {
    return null
  }
  return {
    read: () =>
      pdfViewPositionCache.get(scrollCacheKey) ??
      (preferenceKey
        ? readPdfViewPosition(readFileViewPreference(PDF_VIEW_POSITIONS_STORAGE_KEY, preferenceKey))
        : null),
    write: (position) => {
      setWithLRU(pdfViewPositionCache, scrollCacheKey, position)
      if (preferenceKey) {
        writeFileViewPreference(PDF_VIEW_POSITIONS_STORAGE_KEY, preferenceKey, position)
      }
    }
  }
}
