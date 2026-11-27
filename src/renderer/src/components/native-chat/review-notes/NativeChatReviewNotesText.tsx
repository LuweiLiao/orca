import type { ReactNode } from 'react'
import {
  reviewNotesBlockEntries,
  splitReviewNotesBlocks
} from '../../../../../shared/file-review/review-notes-block'
import { NativeChatReviewNotesPill } from './NativeChatReviewNotesPill'

/** A sent message with its review-notes block shown as the folded pill, the rest as usual. */
export function NativeChatReviewNotesText({
  text,
  renderText
}: {
  text: string
  renderText: (text: string) => ReactNode
}): React.JSX.Element {
  const parts = splitReviewNotesBlocks(text)
  if (!parts.some((part) => typeof part !== 'string')) {
    return <>{renderText(text)}</>
  }
  return (
    <>
      {parts.map((part, index) =>
        typeof part === 'string' ? (
          part.trim() ? (
            <div key={index}>{renderText(part.trim())}</div>
          ) : null
        ) : (
          <div key={index} className="py-0.5">
            <NativeChatReviewNotesPill entries={reviewNotesBlockEntries(part)} />
          </div>
        )
      )}
    </>
  )
}
