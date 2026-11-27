import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
  reviewNotesBlockEntries,
  type ReviewNotesBlock
} from '../../../../../shared/file-review/review-notes-block'
import { NativeChatReviewNotesPill } from './NativeChatReviewNotesPill'

/** The composer's review-notes pill; deleting a note rewrites the block, the last one drops it. */
export function NativeChatReviewNotesNodeView({
  node,
  selected,
  editor,
  deleteNode,
  updateAttributes
}: NodeViewProps): React.JSX.Element {
  const block: ReviewNotesBlock = { count: Number(node.attrs.count), body: String(node.attrs.body) }
  const entries = reviewNotesBlockEntries(block)
  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <NativeChatReviewNotesPill
        entries={entries}
        selected={selected}
        onRemoveEntry={
          editor.isEditable
            ? (index) => {
                const kept = entries.filter((_, entry) => entry !== index)
                if (kept.length === 0) {
                  deleteNode()
                  return
                }
                updateAttributes({ count: kept.length, body: kept.join('\n\n') })
              }
            : undefined
        }
      />
    </NodeViewWrapper>
  )
}
