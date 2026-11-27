import type { JSONContent } from '@tiptap/react'
import {
  promptLeafString,
  promptTextContent
} from '../composer/editor/native-chat-prompt-document-text'
import { REVIEW_NOTES_NODE } from '../composer/editor/native-chat-prompt-review-notes'

/** The draft document with `note` added to its review-notes pill, or a new pill on its own line. */
export function withReviewNoteInDocument(
  document: JSONContent | undefined,
  text: string,
  note: string
): JSONContent {
  const base = document ?? promptTextContent(text)
  let added = false
  const visit = (node: JSONContent): JSONContent => {
    if (added) {
      return node
    }
    if (node.type === REVIEW_NOTES_NODE) {
      added = true
      const body = String(node.attrs?.body ?? '')
      return {
        ...node,
        attrs: {
          ...node.attrs,
          count: Number(node.attrs?.count ?? 0) + 1,
          body: body ? `${body}\n\n${note.trim()}` : note.trim()
        }
      }
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node
  }
  const updated = visit(base)
  if (added) {
    return updated
  }
  const pill: JSONContent = {
    type: 'paragraph',
    content: [{ type: REVIEW_NOTES_NODE, attrs: { count: 1, body: note.trim() } }]
  }
  // An empty draft holds only an empty paragraph; the pill takes its place.
  const blocks = (base.content ?? []).filter(
    (block, _, all) =>
      !(all.length === 1 && block.type === 'paragraph' && !(block.content?.length ?? 0))
  )
  return { ...base, type: 'doc', content: [...blocks, pill] }
}

/** The text a document serializes to: pills read as their tokens, blocks join with newlines. */
export function promptDocumentText(document: JSONContent): string {
  return (document.content ?? [])
    .map((block) =>
      (block.content ?? [])
        .map((node) => promptLeafString(node.type, node.attrs, node.text))
        .join('')
    )
    .join('\n')
}
