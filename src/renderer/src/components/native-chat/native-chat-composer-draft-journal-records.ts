import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  parseStoredNativeChatComposerDraft,
  type StoredNativeChatComposerDraft
} from './native-chat-composer-draft-storage'
import type { NativeChatComposerDraftAddition } from './native-chat-composer-draft-addition'

const LEGACY_KEY = 'orca:nativeChatComposerDraftJournal:v1'
const PREFIX = 'orca:nativeChatComposerDraftJournal:v2:'
const ENTRY_PREFIX = `${PREFIX}entry:`
const PRUNED_PREFIX = `${PREFIX}legacy-pruned:`

type EntryBase = {
  readonly scopeKey: string
  readonly at: number
  readonly run?: string
  readonly id?: string
}
export type DraftJournalEntry = EntryBase & { readonly draft: StoredNativeChatComposerDraft | null }
export type AdditionJournalEntry = EntryBase & {
  readonly addition: NativeChatComposerDraftAddition
}
export type JournalEntry = DraftJournalEntry | AdditionJournalEntry
export type JournalRecord = { key?: string; entry: JournalEntry }

export function nativeChatDraftJournalRecordId(record: JournalRecord): string {
  return record.entry.id ?? record.key ?? `legacy:${JSON.stringify(record.entry)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEntry(entry: unknown): JournalEntry[] {
  if (!isRecord(entry)) {
    return []
  }
  const { scopeKey, draft, at, addition } = entry
  if (typeof scopeKey !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) {
    return []
  }
  const run = typeof entry.run === 'string' ? entry.run : undefined
  const id = typeof entry.id === 'string' ? entry.id : undefined
  if (!isRecord(addition)) {
    return [
      { scopeKey, draft: parseStoredNativeChatComposerDraft(draft), at, run, ...(id ? { id } : {}) }
    ]
  }
  const parsed = parseStoredNativeChatComposerDraft({
    text: typeof addition.text === 'string' ? addition.text : '',
    images: Array.isArray(addition.images) ? addition.images : [],
    savedAt: at
  })
  return parsed
    ? [
        {
          scopeKey,
          at,
          run,
          ...(id ? { id } : {}),
          addition: {
            text: parsed.text,
            images: parsed.images,
            ...(addition.fromUser === true ? { fromUser: true } : {}),
            ...(typeof addition.before === 'string' ? { before: addition.before } : {}),
            ...(Array.isArray(addition.fills)
              ? { fills: addition.fills.filter((id) => typeof id === 'string') }
              : {})
          }
        }
      ]
    : []
}

function parseEntries(raw: string | null): JournalEntry[] {
  if (raw === null) {
    return []
  }
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.flatMap(parseEntry) : parseEntry(value)
  } catch {
    return []
  }
}

export function readNativeChatDraftJournalRecords(): JournalRecord[] {
  const records: JournalRecord[] = []
  const retired = new Set<string>()
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
  for (const key of keys) {
    if (!key || (!key.startsWith(ENTRY_PREFIX) && !key.startsWith(PRUNED_PREFIX))) {
      continue
    }
    const entries = parseEntries(localStorage.getItem(key))
    if (key.startsWith(PRUNED_PREFIX)) {
      entries.forEach((entry) => retired.add(JSON.stringify(entry)))
    } else {
      entries.forEach((entry) => records.push({ key, entry }))
    }
  }
  for (const entry of parseEntries(localStorage.getItem(LEGACY_KEY))) {
    if (!retired.has(JSON.stringify(entry))) {
      records.push({ entry })
    }
  }
  return records.sort((a, b) => a.entry.at - b.entry.at)
}

export function appendNativeChatDraftJournalRecord(entry: JournalEntry): boolean {
  try {
    localStorage.setItem(`${ENTRY_PREFIX}${createBrowserUuid()}`, JSON.stringify(entry))
    return true
  } catch {
    return false
  }
}

export function replaceNativeChatDraftJournalChange(entry: DraftJournalEntry): boolean {
  try {
    const previous = readNativeChatDraftJournalRecords().filter(
      ({ key, entry: old }) =>
        key !== undefined &&
        !('addition' in old) &&
        old.run === entry.run &&
        old.scopeKey === entry.scopeKey &&
        old.at <= entry.at
    )
    if (previous.some(({ entry: old }) => JSON.stringify(old) === JSON.stringify(entry))) {
      return true
    }
    if (!appendNativeChatDraftJournalRecord(entry)) {
      return false
    }
    // Only this run's prior immutable records may go, and only after their replacement is saved.
    for (const { key } of previous) {
      if (key) {
        try {
          localStorage.removeItem(key)
        } catch {
          /* A duplicate is safe to replay. */
        }
      }
    }
    return true
  } catch {
    return false
  }
}

export function pruneNativeChatDraftJournalRecords(
  scopeKey: string,
  at: number,
  confirmedIds?: readonly string[],
  run?: string
): void {
  try {
    // New records have unique immutable keys; a concurrent append cannot be in this snapshot.
    const records = readNativeChatDraftJournalRecords()
    for (const record of records) {
      if (
        record.entry.scopeKey !== scopeKey ||
        (confirmedIds
          ? !confirmedIds.includes(nativeChatDraftJournalRecordId(record)) &&
            !(
              run !== undefined &&
              !('addition' in record.entry) &&
              record.entry.run === run &&
              record.entry.at <= at
            )
          : record.entry.at > at)
      ) {
        continue
      }
      if (record.key) {
        localStorage.removeItem(record.key)
      } else {
        localStorage.setItem(`${PRUNED_PREFIX}${createBrowserUuid()}`, JSON.stringify(record.entry))
      }
    }
  } catch {
    /* Unconfirmed records remain recoverable when cleanup fails. */
  }
}
