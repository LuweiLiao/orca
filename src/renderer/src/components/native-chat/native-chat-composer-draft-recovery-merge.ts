import {
  withNativeChatComposerDraftAddition,
  type NativeChatComposerDraftAddition
} from './native-chat-composer-draft-addition'
import type { StoredNativeChatComposerDraft } from './native-chat-composer-draft-storage'

export function addNativeChatComposerDraftJournalAddition<
  T extends Pick<
    StoredNativeChatComposerDraft,
    | 'text'
    | 'images'
    | 'document'
    | 'journalEntryIds'
    | 'journalAdditions'
    | 'journalAdditionsComplete'
  >
>(draft: T, addition: NativeChatComposerDraftAddition, id: string): T {
  if (draft.journalEntryIds?.includes(id)) {
    return draft
  }
  return {
    ...draft,
    ...withNativeChatComposerDraftAddition(draft, addition),
    journalEntryIds: [...(draft.journalEntryIds ?? []), id],
    journalAdditions: [...(draft.journalAdditions ?? []), { id, addition }],
    journalAdditionsComplete:
      draft.journalAdditionsComplete ??
      (draft.journalEntryIds ?? []).every((held) =>
        draft.journalAdditions?.some((entry) => entry.id === held)
      )
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
  const known = new Set(previous.journalAdditions?.map(({ id }) => id))
  const unrepresented =
    previous.journalEntryIds?.filter(
      (id) => !known.has(id) && !merged.journalEntryIds?.includes(id)
    ) ?? []
  if (previous.journalAdditionsComplete !== true && unrepresented.length > 0) {
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
      journalEntryIds: [
        ...new Set([...(merged.journalEntryIds ?? []), ...(previous.journalEntryIds ?? [])])
      ],
      journalAdditions: [
        ...new Map(
          [...(merged.journalAdditions ?? []), ...(previous.journalAdditions ?? [])].map(
            (entry) => [entry.id, entry]
          )
        ).values()
      ],
      journalAdditionsComplete: false
    }
  }
  for (const { id, addition } of previous.journalAdditions ?? []) {
    merged = addNativeChatComposerDraftJournalAddition(merged, addition, id)
  }
  return { ...merged, ...(!merged.owner && previous.owner ? { owner: previous.owner } : {}) }
}
