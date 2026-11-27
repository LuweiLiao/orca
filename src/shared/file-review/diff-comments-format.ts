import type { DiffComment, PdfNoteTexSource } from './diff-comment-types'

function isMarkdownComment(comment: Pick<DiffComment, 'source'>): boolean {
  return comment.source === 'markdown'
}

/** Line notes on any text file are stored as source 'markdown'; tell the agent which kind it is. */
export function textNoteSourceLabel(filePath: string): string {
  return /\.(md|mdx|markdown)$/i.test(filePath) ? 'Source: markdown' : 'Source: text'
}

// Keep the pasted review-note contract deterministic and quote-safe across clients/agents.
export function formatDiffComment(c: DiffComment): string {
  const escaped = c.body
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
  const locationLabel =
    c.lineNumber === 0
      ? 'Scope: file'
      : c.startLine !== undefined && c.startLine !== c.lineNumber
        ? `Lines: ${c.startLine}-${c.lineNumber}`
        : `Line: ${c.lineNumber}`
  if (c.source === 'pdf') {
    return formatPdfComment(c, escaped)
  }
  if (!isMarkdownComment(c)) {
    return [`File: ${c.filePath}`, locationLabel, `User comment: "${escaped}"`].join('\n')
  }
  // Line numbers go stale once the file is edited; the text the note was left on still locates it.
  const excerpt = c.selectedText?.trim()
  return [
    `File: ${c.filePath}`,
    textNoteSourceLabel(c.filePath),
    locationLabel,
    ...(excerpt ? [`Excerpt:\n${quoteMarkdownNoteExcerpt(excerpt)}`] : []),
    `User comment: "${escaped}"`
  ].join('\n')
}

export function formatPdfNoteTexLocation(tex: PdfNoteTexSource): string {
  return tex.startLine === tex.endLine
    ? `${tex.filePath}:${tex.startLine}`
    : `${tex.filePath}:${tex.startLine}-${tex.endLine}`
}

function formatPdfComment(c: DiffComment, escapedBody: string): string {
  const region = c.pdfRegion
  const tex = c.pdfTexSource
  const excerpt = c.selectedText?.trim()
  const round = (value: number): number => Math.round(value)
  return [
    `File: ${c.filePath}`,
    'Source: pdf',
    `Page: ${region?.page ?? c.lineNumber}`,
    ...(region
      ? [
          `Region (PDF points from the page's top-left): x ${round(region.left)}-${round(region.left + region.width)}, y ${round(region.top)}-${round(region.top + region.height)}`
        ]
      : []),
    ...(tex ? [`TeX source (SyncTeX): ${formatPdfNoteTexLocation(tex)}`] : []),
    ...(excerpt ? [`Excerpt:\n${quoteMarkdownNoteExcerpt(excerpt)}`] : []),
    `User comment: "${escapedBody}"`
  ].join('\n')
}

export function quoteMarkdownNoteExcerpt(text: string): string {
  return `> ${text.replace(/\r\n|\r|\n/g, '\n> ')}`
}

export function formatDiffComments(comments: readonly DiffComment[]): string {
  return comments.map(formatDiffComment).join('\n\n')
}
