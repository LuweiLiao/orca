import type {
  DiffComment,
  DiffCommentSource
} from '../../../../../../shared/file-review/diff-comment-types'

export function getDiffCommentSource(comment: Pick<DiffComment, 'source'>): DiffCommentSource {
  return comment.source === 'markdown' || comment.source === 'pdf' ? comment.source : 'diff'
}

export function isDiffComment(comment: Pick<DiffComment, 'source'>): boolean {
  return getDiffCommentSource(comment) === 'diff'
}

export function isMarkdownComment(comment: Pick<DiffComment, 'source'>): boolean {
  return getDiffCommentSource(comment) === 'markdown'
}

export function isPdfComment(comment: Pick<DiffComment, 'source'>): boolean {
  return getDiffCommentSource(comment) === 'pdf'
}

export function getDiffCommentLineLabel(
  comment: Pick<DiffComment, 'lineNumber' | 'startLine' | 'source'>,
  compact = false
): string {
  if (comment.source === 'pdf') {
    return compact ? `P${comment.lineNumber}` : `Page ${comment.lineNumber}`
  }
  if (comment.startLine !== undefined && comment.startLine !== comment.lineNumber) {
    return compact
      ? `L${comment.startLine}-L${comment.lineNumber}`
      : `Lines ${comment.startLine}-${comment.lineNumber}`
  }
  return compact ? `L${comment.lineNumber}` : `Line ${comment.lineNumber}`
}
