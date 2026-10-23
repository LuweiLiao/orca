import {
  nextSavedAt,
  type DraftRecord,
  type DraftTransform
} from './native-chat-composer-draft-memory'
import { savedNativeChatComposerDraft } from './native-chat-composer-draft-saved-form'
import {
  nativeChatComposerDraftStorage,
  parseStoredNativeChatComposerDraft,
  type StoredNativeChatComposerDraft
} from './native-chat-composer-draft-storage'

export function writeNativeChatComposerDraftTransaction(
  scopeKey: string,
  transform: DraftTransform,
  record: DraftRecord | undefined,
  applied: (draft: DraftRecord | null) => void
): Promise<void> {
  return nativeChatComposerDraftStorage().update(scopeKey, (stored) => {
    const base = parseStoredNativeChatComposerDraft(stored) ?? { text: '', images: [], savedAt: 0 }
    const next = transform(base)
    const owner = base.owner ?? next?.owner ?? record?.owner
    const draft =
      next === null
        ? null
        : {
            ...next,
            savedAt: nextSavedAt(Math.max(base.savedAt, next.savedAt, record?.savedAt ?? 0) + 1),
            ...(owner ? { owner } : {})
          }
    applied(draft)
    return draft ? savedNativeChatComposerDraft(draft) : null
  })
}

export const EMPTY_NATIVE_CHAT_STORED_DRAFT: StoredNativeChatComposerDraft = {
  text: '',
  images: [],
  savedAt: 0
}
