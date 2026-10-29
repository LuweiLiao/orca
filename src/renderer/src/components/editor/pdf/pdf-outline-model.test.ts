import { describe, expect, it } from 'vitest'
import {
  currentPdfOutlineRow,
  flattenPdfOutline,
  pdfOutlineAncestors,
  visiblePdfOutlineRows,
  type PdfOutlineNode
} from './pdf-outline-model'

const node = (title: string, items: PdfOutlineNode[] = []): PdfOutlineNode => ({
  title,
  dest: title,
  items
})

const outline = [
  node('1 Introduction'),
  node('2 Method', [node('2.1 Setup', [node('2.1.1 Data')]), node('2.2 Model')]),
  node('3 Results')
]

describe('pdf outline', () => {
  it('flattens nested bookmarks in document order with their parents', () => {
    const rows = flattenPdfOutline([node('A\n  title\u0000'), ...outline])
    expect(rows.map((row) => [row.id, row.depth, row.title])).toEqual([
      ['0', 0, 'A title'],
      ['1', 0, '1 Introduction'],
      ['2', 0, '2 Method'],
      ['2.0', 1, '2.1 Setup'],
      ['2.0.0', 2, '2.1.1 Data'],
      ['2.1', 1, '2.2 Model'],
      ['3', 0, '3 Results']
    ])
    expect(rows.find((row) => row.id === '2')?.hasChildren).toBe(true)
  })

  it('shows a child only while every ancestor is expanded', () => {
    const rows = flattenPdfOutline(outline)
    const titles = (expanded: string[]) =>
      visiblePdfOutlineRows(rows, new Set(expanded)).map((row) => row.title)

    expect(titles([])).toEqual(['1 Introduction', '2 Method', '3 Results'])
    expect(titles(['1'])).toEqual([
      '1 Introduction',
      '2 Method',
      '2.1 Setup',
      '2.2 Model',
      '3 Results'
    ])
    // A grandchild stays folded while its parent is, even if it was expanded itself.
    expect(titles(['1.0'])).toEqual(['1 Introduction', '2 Method', '3 Results'])
    expect(pdfOutlineAncestors('1.0.0')).toEqual(['1', '1.0'])
  })

  it('marks the last section that starts on or before the current page', () => {
    const rows = flattenPdfOutline(outline)
    const pageOf = new Map([
      ['0', 1],
      ['1', 4],
      ['1.0', 4],
      ['1.0.0', 6],
      ['1.1', 9],
      ['2', 12]
    ])
    expect(currentPdfOutlineRow(rows, pageOf, 1)).toBe('0')
    expect(currentPdfOutlineRow(rows, pageOf, 5)).toBe('1.0')
    expect(currentPdfOutlineRow(rows, pageOf, 10)).toBe('1.1')
    expect(currentPdfOutlineRow(rows, new Map(), 10)).toBeNull()
  })

  it('keeps a picked section among several that start on the same page', () => {
    const rows = flattenPdfOutline(outline)
    const pageOf = new Map([
      ['1', 4],
      ['1.0', 4],
      ['1.0.0', 4],
      ['2', 12]
    ])
    expect(currentPdfOutlineRow(rows, pageOf, 4)).toBe('1.0.0')
    expect(currentPdfOutlineRow(rows, pageOf, 4, '1')).toBe('1')
    expect(currentPdfOutlineRow(rows, pageOf, 13, '1')).toBe('2')
  })
})
