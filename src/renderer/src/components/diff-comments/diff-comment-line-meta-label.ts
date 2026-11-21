import type { DiffComment } from '../../../../shared/file-review/diff-comment-types'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

// Card meta text, e.g. "Note line 4 sent"; agent prompts keep the English getDiffCommentLineLabel.
export function getDiffCommentLineMetaLabel(
  comment: Pick<DiffComment, 'lineNumber' | 'startLine' | 'source'>,
  t: Translate = translate
): string {
  if (comment.source === 'pdf') {
    return t('diffComments.pageMeta', 'page {{page}}', { page: comment.lineNumber })
  }
  if (comment.startLine !== undefined && comment.startLine !== comment.lineNumber) {
    return t('diffComments.lineRangeMeta', 'lines {{start}}-{{end}}', {
      start: comment.startLine,
      end: comment.lineNumber
    })
  }
  return t('diffComments.lineMeta', 'line {{line}}', { line: comment.lineNumber })
}
