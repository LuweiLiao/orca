import type { JSONContent } from '@tiptap/react'
import { splitReviewNotesBlocks } from '../../../../../../shared/file-review/review-notes-block'

/** Kept here, not with the other node names, so this module needs nothing from the text one. */
export const REVIEW_NOTES_NODE = 'nativeChatReviewNotes'

/**
 * A review-notes block spans lines, so it becomes one pill on a line of its own before the rest
 * of the text is split into lines by `linesContent`.
 */
export function promptTextWithReviewNotes(
  text: string,
  linesContent: (text: string) => JSONContent
): JSONContent {
  const parts = splitReviewNotesBlocks(text)
  if (!parts.some((part) => typeof part !== 'string')) {
    return linesContent(text)
  }
  return {
    type: 'doc',
    content: parts.flatMap((part, index): JSONContent[] => {
      if (typeof part !== 'string') {
        return [
          {
            type: 'paragraph',
            content: [{ type: REVIEW_NOTES_NODE, attrs: { count: part.count, body: part.body } }]
          }
        ]
      }
      // The line break on each side of a block is the block's own line edge.
      let lines = part
      if (index > 0) {
        lines = lines.replace(/^\n/, '')
      }
      if (index < parts.length - 1) {
        lines = lines.replace(/\n$/, '')
      }
      return lines === '' ? [] : (linesContent(lines).content ?? [])
    })
  }
}
