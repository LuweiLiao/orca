import { translate } from '@/i18n/i18n'

export type ReviewNoteSummary = {
  file: string
  /** File name with the page or lines the note is on, e.g. "main.pdf · page 2". */
  location: string
  excerpt: string
  comment: string
}

/** Reads back one note as formatDiffComment wrote it, for display only. */
export function reviewNoteSummary(entry: string): ReviewNoteSummary {
  const lines = entry.split('\n')
  const field = (name: string): string | undefined =>
    lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2)
  const file = field('File') ?? ''
  const name = file.split(/[\\/]/).at(-1) || file
  const page = field('Page')
  const range = field('Lines')
  const line = field('Line')
  const where = page
    ? translate('diffComments.pageMeta', 'page {{page}}', { page })
    : range
      ? translate('diffComments.lineRangeMeta', 'lines {{start}}-{{end}}', {
          start: range.split('-')[0],
          end: range.split('-')[1]
        })
      : line
        ? translate('diffComments.lineMeta', 'line {{line}}', { line })
        : null
  const excerptStart = lines.indexOf('Excerpt:')
  const commentIndex = lines.findIndex((entryLine) => entryLine.startsWith('User comment: "'))
  const excerpt =
    excerptStart === -1
      ? ''
      : lines
          .slice(excerptStart + 1, commentIndex === -1 ? undefined : commentIndex)
          .map((quoted) => quoted.replace(/^> ?/, ''))
          .join('\n')
          .trim()
  const rawComment = commentIndex === -1 ? '' : lines[commentIndex]!.slice('User comment: "'.length)
  return {
    file,
    location: where ? `${name} · ${where}` : name,
    excerpt,
    comment: unescapeComment(rawComment.endsWith('"') ? rawComment.slice(0, -1) : rawComment)
  }
}

function unescapeComment(text: string): string {
  return text.replace(/\\(.)/g, (_, character: string) =>
    character === 'n' ? '\n' : character === 'r' ? '\r' : character
  )
}
