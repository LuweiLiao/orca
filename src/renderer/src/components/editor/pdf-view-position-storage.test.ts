// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { pdfViewPositionCache } from '@/lib/scroll-cache'
import { pdfViewPositionStore } from './pdf-view-position-storage'

afterEach(() => {
  pdfViewPositionCache.clear()
  localStorage.clear()
})

describe('pdfViewPositionStore', () => {
  it('reopens a file on its last page after a restart', () => {
    pdfViewPositionStore('tab-a:pdf', 'report')!.write({ pageNumber: 12, top: 300, left: 0 })
    pdfViewPositionCache.clear()

    expect(pdfViewPositionStore('tab-b:pdf', 'report')!.read()).toEqual({
      pageNumber: 12,
      top: 300,
      left: 0
    })
  })

  it("prefers the tab's own position to the file's last one", () => {
    pdfViewPositionStore('tab-a:pdf', 'report')!.write({ pageNumber: 3, top: 0, left: 0 })
    pdfViewPositionStore('tab-b:pdf', 'report')!.write({ pageNumber: 9, top: 0, left: 0 })

    expect(pdfViewPositionStore('tab-a:pdf', 'report')!.read()?.pageNumber).toBe(3)
  })

  it('keeps a position only in memory without a file key, and none without a tab key', () => {
    pdfViewPositionStore('diff:pdf', null)!.write({ pageNumber: 4, top: 0, left: 0 })

    expect(localStorage.length).toBe(0)
    expect(pdfViewPositionStore(null, 'report')).toBeNull()
  })

  it('ignores a malformed stored position', () => {
    localStorage.setItem(
      'orca.pdf.view-positions.v1',
      JSON.stringify({ report: { pageNumber: 0, top: 'x' } })
    )

    expect(pdfViewPositionStore('tab-a:pdf', 'report')!.read()).toBeNull()
  })
})
