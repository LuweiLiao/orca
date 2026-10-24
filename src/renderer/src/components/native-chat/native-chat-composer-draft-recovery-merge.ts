import {
  withNativeChatComposerDraftAddition,
  type NativeChatComposerDraftAddition
} from './native-chat-composer-draft-addition'
import type { StoredNativeChatComposerDraft } from './native-chat-composer-draft-storage'

export function addNativeChatComposerDraftJournalAddition<
  T extends Pick<
    StoredNativeChatComposerDraft,
    'text' | 'images' | 'document' | 'journalEntryIds' | 'journalAdditions'
  >
>(draft: T, addition: NativeChatComposerDraftAddition, id: string): T {
  if (draft.journalEntryIds?.includes(id)) {
    return draft
  }
  return {
    ...draft,
    ...withNativeChatComposerDraftAddition(draft, addition),
    journalEntryIds: [...(draft.journalEntryIds ?? []), id],
    journalAdditions: [...(draft.journalAdditions ?? []), { id, addition }]
  }
}

/** A whole edit replaces its baseline, while independent additions from another window survive. */
export function mergeNativeChatComposerDraftRecovery(
  previous: StoredNativeChatComposerDraft | null | undefined,
  recovered: StoredNativeChatComposerDraft | null
): StoredNativeChatComposerDraft | null {
  if (!previous || !recovered) {
    return recovered
  }
  let merged = recovered
  for (const { id, addition } of previous.journalAdditions ?? []) {
    merged = addNativeChatComposerDraftJournalAddition(merged, addition, id)
  }
  const unrepresented =
    previous.journalEntryIds?.filter((id) => !merged.journalEntryIds?.includes(id)) ?? []
  if (previous.journalAdditions === undefined && unrepresented.length > 0) {
    // Older drafts have ids but no per-addition contents; retain their text rather than discard it.
    const text = withNativeChatComposerDraftAddition(merged, { text: previous.text })
    const images = withNativeChatComposerDraftAddition(
      { ...merged, ...text },
      {
        images: previous.images.filter(
          (image) => !merged.images.some((held) => held.id === image.id)
        )
      }
    )
    merged = {
      ...merged,
      ...text,
      ...images,
      journalEntryIds: [...(merged.journalEntryIds ?? []), ...unrepresented]
    }
  }
  return { ...merged, ...(!merged.owner && previous.owner ? { owner: previous.owner } : {}) }
}
