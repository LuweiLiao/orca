import type { JSONContent } from '@tiptap/react'

import { IMAGE_REFERENCE_NODE } from './native-chat-prompt-document-text'

/** The document side of withoutImageReference: each chip goes with one space after it. */
export function withoutImageReferenceNodes(
  document: JSONContent,
  attachmentId: string
): JSONContent {
  const isChip = (node: JSONContent | undefined): boolean =>
    node?.type === IMAGE_REFERENCE_NODE && node.attrs?.attachmentId === attachmentId
  return document.content
    ? {
        ...document,
        content: document.content.flatMap((node, index, nodes) => {
          if (isChip(node)) {
            return []
          }
          if (isChip(nodes[index - 1]) && node.type === 'text' && node.text?.startsWith(' ')) {
            const text = node.text.slice(1)
            return text ? [{ ...node, text }] : []
          }
          return [withoutImageReferenceNodes(node, attachmentId)]
        })
      }
    : document
}
