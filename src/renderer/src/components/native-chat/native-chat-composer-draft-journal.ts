// Recovery records are independent writes, so another window cannot replace an acknowledged append.
import type { UnconfirmedDraftChange } from './native-chat-composer-draft-memory'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { NativeChatComposerDraftAddition } from './native-chat-composer-draft-addition'
import type {
  NativeChatComposerDraftOwner,
  StoredNativeChatComposerDraft
} from './native-chat-composer-draft-storage'
import {
  addNativeChatComposerDraftJournalAddition,
  mergeNativeChatComposerDraftRecovery
} from './native-chat-composer-draft-recovery-merge'
import {
  appendNativeChatDraftJournalRecord,
  replaceNativeChatDraftJournalChange,
  readNativeChatDraftJournalRecords,
  pruneNativeChatDraftJournalRecords,
  nativeChatDraftJournalRecordId,
  type AdditionJournalEntry,
  type JournalEntry,
  type JournalRecord
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

export type NativeChatComposerDraftJournalSnapshot = readonly JournalRecord[]

/** Capture before loading: later writes belong to a live window and must not be replayed. */
export function snapshotNativeChatComposerDraftJournal(): NativeChatComposerDraftJournalSnapshot {
  try {
    return readNativeChatDraftJournalRecords().filter(({ entry }) => entry.run !== THIS_RUN)
  } catch {
    return []
  }
}

export function replayNativeChatComposerDraftJournal(
  drafts: Map<string, StoredNativeChatComposerDraft | null>,
  entries: NativeChatComposerDraftJournalSnapshot
): Set<string> {
  const changed = new Set<string>()
  const confirmed = new Map(drafts)
  const removedAt = new Map<string, number>()
  const wholeIds = new Map<string, string[]>()
  for (const record of entries) {
    const entry = record.entry
    if (isAddition(entry)) {
      continue
    }
    const id = nativeChatDraftJournalRecordId(record)
    const stored = confirmed.get(entry.scopeKey)
    if (stored && stored.savedAt >= entry.at) {
      pruneNativeChatDraftJournalRecords(entry.scopeKey, entry.at, [id])
      continue
    }
    const previousIds = wholeIds.get(entry.scopeKey) ?? []
    wholeIds.set(entry.scopeKey, [...previousIds, id])
    const previous = drafts.get(entry.scopeKey)
    const next =
      previous?.journalEntryIds &&
      entry.draft?.journalEntryIds &&
      previous.editRevision !== undefined &&
      previous.editRevision === entry.draft.editRevision
        ? mergeNativeChatComposerDraftRecovery(entry.draft, previous)
        : mergeNativeChatComposerDraftRecovery(previous, entry.draft)
    drafts.set(
      entry.scopeKey,
      next
        ? {
            ...next,
            journalEntryIds: [...new Set([...previousIds, ...(next.journalEntryIds ?? []), id])]
          }
        : null
    )
    if (!entry.draft) {
      removedAt.set(entry.scopeKey, entry.at)
    }
    changed.add(entry.scopeKey)
  }
  const additions = entries
    .filter(({ entry }) => isAddition(entry))
    .sort((left, right) => left.entry.at - right.entry.at)
  for (const record of additions) {
    if (!isAddition(record.entry)) {
      continue
    }
    const { scopeKey, at, addition } = record.entry
    const id = nativeChatDraftJournalRecordId(record)
    const stored = confirmed.get(scopeKey)
    if (
      stored?.journalEntryIds?.includes(id) ||
      (!record.key &&
        !record.entry.id &&
        stored?.journalEntryIds === undefined &&
        (stored?.savedAt ?? 0) >= at)
    ) {
      pruneNativeChatDraftJournalRecords(scopeKey, at, [id])
      continue
    }
    const base = drafts.get(scopeKey) ?? null
    if (base?.journalEntryIds?.includes(id) || (removedAt.get(scopeKey) ?? -Infinity) >= at) {
      continue
    }
    const from = base ?? { text: '', images: [], savedAt: 0 }
    drafts.set(scopeKey, {
      ...from,
      ...addNativeChatComposerDraftJournalAddition(from, addition, id),
      savedAt: Math.max(from.savedAt, at),
      ...(!from.owner && record.entry.owner ? { owner: record.entry.owner } : {})
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
  at: number,
  id = createBrowserUuid(),
  owner?: NativeChatComposerDraftOwner
): boolean {
  const entry = { scopeKey, at, run: THIS_RUN, addition, id, ...(owner ? { owner } : {}) }
  const entries = [...readEntries().filter(isAddition), entry]
  return (
    JSON.stringify(entries).length <= MAX_JOURNAL_ADDITIONS_CHARS &&
    appendNativeChatDraftJournalRecord(entry)
  )
}

export function pruneNativeChatComposerDraftJournal(
  scopeKey: string,
  confirmedAt: number,
  confirmedIds?: readonly string[]
): void {
  pruneNativeChatDraftJournalRecords(scopeKey, confirmedAt, confirmedIds, THIS_RUN)
}
