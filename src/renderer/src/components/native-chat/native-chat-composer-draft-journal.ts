// Recovery records are independent writes, so another window cannot replace an acknowledged append.
import type { UnconfirmedDraftChange } from './native-chat-composer-draft-memory'
import {
  withNativeChatComposerDraftAddition,
  type NativeChatComposerDraftAddition
} from './native-chat-composer-draft-addition'
import type { StoredNativeChatComposerDraft } from './native-chat-composer-draft-storage'
import {
  appendNativeChatDraftJournalRecord,
  replaceNativeChatDraftJournalChange,
  readNativeChatDraftJournalRecords,
  pruneNativeChatDraftJournalRecords,
  type AdditionJournalEntry,
  type JournalEntry
} from './native-chat-composer-draft-journal-records'

export const MAX_JOURNAL_CHARS = 256_000
export const MAX_JOURNAL_ADDITIONS_CHARS = 800_000
const THIS_RUN = `${Date.now()}-${Math.random()}`

function isAddition(entry: JournalEntry): entry is AdditionJournalEntry {
  return 'addition' in entry
}

function readEntries(): JournalEntry[] {
  try {
    return readNativeChatDraftJournalRecords().map(({ entry }) => entry)
  } catch {
    return []
  }
}

export type NativeChatComposerDraftJournalSnapshot = readonly JournalEntry[]

/** Capture before loading: later writes belong to a live window and must not be replayed. */
export function snapshotNativeChatComposerDraftJournal(): NativeChatComposerDraftJournalSnapshot {
  return readEntries().filter((entry) => entry.run !== THIS_RUN)
}

export function replayNativeChatComposerDraftJournal(
  drafts: Map<string, StoredNativeChatComposerDraft | null>,
  entries: NativeChatComposerDraftJournalSnapshot
): Set<string> {
  const changed = new Set<string>()
  const removedAt = new Map<string, number>()
  for (const entry of entries) {
    if (isAddition(entry)) {
      continue
    }
    const stored = drafts.get(entry.scopeKey)
    if (stored && stored.savedAt >= entry.at) {
      pruneNativeChatComposerDraftJournal(entry.scopeKey, entry.at)
      continue
    }
    drafts.set(entry.scopeKey, entry.draft)
    if (!entry.draft) {
      removedAt.set(entry.scopeKey, entry.at)
    }
    changed.add(entry.scopeKey)
  }
  const additions = entries.filter(isAddition).sort((left, right) => left.at - right.at)
  for (const { scopeKey, at, addition } of additions) {
    const base = drafts.get(scopeKey) ?? null
    if ((base?.savedAt ?? removedAt.get(scopeKey) ?? 0) >= at) {
      pruneNativeChatComposerDraftJournal(scopeKey, at)
      continue
    }
    const from = base ?? { text: '', images: [], savedAt: 0 }
    drafts.set(scopeKey, {
      ...from,
      ...withNativeChatComposerDraftAddition(from, addition),
      savedAt: at
    })
    changed.add(scopeKey)
  }
  return changed
}

/** Whole drafts share a size budget; removals remain small and are always attempted. */
export function journalNativeChatComposerDraftChanges(
  changes: ReadonlyMap<string, UnconfirmedDraftChange>
): void {
  if (changes.size === 0) {
    return
  }
  const entries = readEntries().filter(
    (entry) => isAddition(entry) || entry.run !== THIS_RUN || !changes.has(entry.scopeKey)
  )
  let used = JSON.stringify(entries.filter((entry) => !isAddition(entry) && entry.draft)).length
  const bySize = [...changes]
    .map(([scopeKey, change]) => ({ scopeKey, ...change, run: THIS_RUN }))
    .map((entry) => ({ entry, size: JSON.stringify(entry).length + 1 }))
    .sort((left, right) => left.size - right.size)
  for (const { entry, size } of bySize) {
    if (!entry.draft) {
      replaceNativeChatDraftJournalChange(entry)
      continue
    }
    if (used + size <= MAX_JOURNAL_CHARS && replaceNativeChatDraftJournalChange(entry)) {
      used += size
    }
  }
}

/** True only after this addition has its own synchronously persisted recovery record. */
export function journalNativeChatComposerDraftAddition(
  scopeKey: string,
  addition: NativeChatComposerDraftAddition,
  at: number
): boolean {
  const entry = { scopeKey, at, run: THIS_RUN, addition }
  const entries = [...readEntries().filter(isAddition), entry]
  return (
    JSON.stringify(entries).length <= MAX_JOURNAL_ADDITIONS_CHARS &&
    appendNativeChatDraftJournalRecord(entry)
  )
}

export function pruneNativeChatComposerDraftJournal(scopeKey: string, confirmedAt: number): void {
  pruneNativeChatDraftJournalRecords(scopeKey, confirmedAt)
}
