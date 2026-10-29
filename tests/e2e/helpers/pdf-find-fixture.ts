import { gzipSync } from 'node:zlib'

/** A bookmark in the fixture's outline: it opens a page, and may hold bookmarks of its own. */
export type PdfFixtureBookmark = { title: string; page: number; children?: PdfFixtureBookmark[] }

export function createPdfFindFixture({
  title = 'PDF search fixture',
  /** Grows the file with a stream no page references, for size-dependent paths. */
  paddingBytes = 0,
  outline = []
}: {
  title?: string
  paddingBytes?: number
  outline?: readonly PdfFixtureBookmark[]
} = {}): Buffer {
  const objects = [
    outline.length > 0
      ? '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /PageMode /UseOutlines >>'
      : '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  for (let page = 0; page < 3; page += 1) {
    const contentId = 5 + page * 2
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`
    )
    const lines = [
      `${title} - page ${page + 1}`,
      `needle result ${page * 2 + 1}`,
      `needle result ${page * 2 + 2}`,
      page === 1 ? 'Plain text without the alternate query' : 'beacon alternate query'
    ]
    const stream = `BT /F1 20 Tf 60 700 Td 40 TL ${lines.map((line) => `(${line}) Tj T*`).join(' ')} ET\n`
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`)
  }
  if (outline.length > 0) {
    appendOutline(objects, outline)
  }
  if (paddingBytes > 0) {
    objects.push(`<< /Length ${paddingBytes} >>\nstream\n${'x'.repeat(paddingBytes)}\nendstream`)
  }
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

/** Outline objects start at 10, right after the catalog, pages, font, and three page pairs. */
function appendOutline(objects: string[], outline: readonly PdfFixtureBookmark[]): void {
  const rootId = 10
  objects.push('')
  const place = (items: readonly PdfFixtureBookmark[], parentId: number): number[] => {
    const ids = items.map(() => {
      objects.push('')
      return objects.length
    })
    items.forEach((item, index) => {
      const childIds = item.children?.length ? place(item.children, ids[index]!) : []
      const pageId = 4 + (item.page - 1) * 2
      const links = [
        index > 0 ? `/Prev ${ids[index - 1]} 0 R` : '',
        index < ids.length - 1 ? `/Next ${ids[index + 1]} 0 R` : '',
        childIds.length
          ? `/First ${childIds[0]} 0 R /Last ${childIds.at(-1)} 0 R /Count ${childIds.length}`
          : ''
      ].join(' ')
      objects[ids[index]! - 1] =
        `<< /Title (${item.title}) /Parent ${parentId} 0 R /Dest [${pageId} 0 R /Fit] ${links} >>`
    })
    return ids
  }
  const top = place(outline, rootId)
  objects[rootId - 1] =
    `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top.at(-1)} 0 R /Count ${top.length} >>`
}

/** A source line the SyncTeX fixture places on a page, at one of the fixture's text lines. */
export type PdfSynctexFixtureLine = { page: number; textLine: number; sourceLine: number }

/**
 * A gzipped SyncTeX index for `createPdfFindFixture`'s layout (text at x=60pt, baselines from
 * y=700pt every 40pt on a 612x792 page), mapping its text lines to lines of `texPath`.
 */
export function createPdfSynctexFixture(
  texPath: string,
  lines: readonly PdfSynctexFixtureLine[]
): Buffer {
  const sp = (bp: number): number => Math.round(bp * 65781.76)
  const content: string[] = []
  for (const page of [...new Set(lines.map((line) => line.page))].sort((a, b) => a - b)) {
    content.push(`{${page}`, `[1,1:${sp(60)},${sp(752)}:${sp(492)},${sp(752)},0`)
    for (const line of lines.filter((candidate) => candidate.page === page)) {
      const baseline = sp(792 - (700 - line.textLine * 40))
      const tagged = `1,${line.sourceLine}`
      content.push(
        `(${tagged}:${sp(60)},${baseline}:${sp(400)},${sp(16)},${sp(5)}`,
        `x${tagged}:${sp(60)},${baseline}`,
        `x${tagged}:${sp(200)},${baseline}`,
        ')'
      )
    }
    content.push(']', `}${page}`)
  }
  const text = [
    'SyncTeX Version:1',
    `Input:1:${texPath}`,
    'Output:pdf',
    'Magnification:1000',
    'Unit:1',
    'X Offset:0',
    'Y Offset:0',
    'Content:',
    ...content,
    'Postamble:',
    ''
  ].join('\n')
  return gzipSync(text)
}
