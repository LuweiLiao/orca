import { nativeChatPastedTextToken } from './native-chat-pasted-text-reference'
import { appendPromptDocumentText } from './native-chat-prompt-document-text'
import type { DraftRecord, DraftTransform } from './native-chat-composer-draft-memory'

export function withNativeChatComposerDraftMetadata(
  pending: DraftTransform,
  record: DraftRecord,
  change: Pick<DraftRecord, 'document' | 'pastedTextFiles'>
): DraftTransform {
  return (base) => {
    const next = pending(base)
    if (!next) {
      return next
    }
    const result = { ...next }
    if ('document' in change) {
      if (next.text === record.text) {
        result.document = change.document
      } else if (next.text.startsWith(record.text.trimEnd())) {
        result.document = appendPromptDocumentText(change.document, record.text, next.text)
      }
    }
    if ('pastedTextFiles' in change) {
      const paths = { ...next.pastedTextFiles }
      for (const id of Object.keys(record.pastedTextFiles ?? {})) {
        delete paths[id]
      }
      result.pastedTextFiles = Object.fromEntries(
        Object.entries({ ...paths, ...change.pastedTextFiles }).filter(([id]) =>
          next.text.includes(nativeChatPastedTextToken(id))
        )
      )
    }
    return result
  }
}
