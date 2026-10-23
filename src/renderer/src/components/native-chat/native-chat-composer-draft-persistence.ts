// Keeps storage a copy of the draft store's memory: writes each changed draft whole, journals what
// storage has not confirmed when the window goes away, and follows other windows' writes.

import { savedNativeChatComposerDraft as savedForm } from './native-chat-composer-draft-saved-form'
export {
  isKeptLocalPaste,
  unavailableNativeChatComposerDraftImage
} from './native-chat-composer-draft-saved-form'
import {
  dirtyScopes,
  load,
  localDraftEdits,
  pendingDraftTransforms,
  nextSavedAt,
  notifyScope,
  records,
  refusedScopes,
  unconfirmed,
  type AppendBeforeLoad,
  type DraftAppend,
  type DraftTransform,
  type DraftRecord,
  type UnconfirmedDraftChange
} from './native-chat-composer-draft-memory'
import {
  journalNativeChatComposerDraftChanges,
  pruneNativeChatComposerDraftJournal
} from './native-chat-composer-draft-journal'
import {
  nativeChatDraftJournalRecordId,
  readNativeChatDraftJournalRecords
} from './native-chat-composer-draft-journal-records'
import {
  nativeChatComposerDraftStorage,
  parseStoredNativeChatComposerDraft,
  type StoredNativeChatComposerDraft
} from './native-chat-composer-draft-storage'
import {
  writeNativeChatComposerDraftTransaction,
  EMPTY_NATIVE_CHAT_STORED_DRAFT
} from './native-chat-composer-draft-transaction'
import {
  broadcastNativeChatComposerDraftChange,
  resetNativeChatComposerDraftBroadcastForTests
} from './native-chat-composer-draft-broadcast'
export { installNativeChatComposerDraftBroadcast } from './native-chat-composer-draft-broadcast'

const PERSIST_DEBOUNCE_MS = 250

let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushOnHideInstalled = false
const inFlight = new Set<Promise<boolean>>()
// Per scope, the writes not yet settled: each resolves true once committed, false when refused.
const scopeWrites = new Map<string, Set<Promise<boolean>>>()

function confirm(
  scopeKey: string,
  change: UnconfirmedDraftChange,
  confirmedIds: readonly string[]
): void {
  if (unconfirmed.get(scopeKey) === change) {
    unconfirmed.delete(scopeKey)
    if (refusedScopes.delete(scopeKey)) {
      notifyScope(scopeKey)
    }
  }
  if (change.draft?.editRevision && localDraftEdits.get(scopeKey) === change.draft.editRevision) {
    localDraftEdits.delete(scopeKey)
  }
  pruneNativeChatComposerDraftJournal(scopeKey, change.at, confirmedIds)
  broadcastNativeChatComposerDraftChange(scopeKey)
}

function refuse(scopeKey: string, change: UnconfirmedDraftChange, error: unknown): void {
  if (unconfirmed.get(scopeKey) !== change) {
    return
  }
  unconfirmed.delete(scopeKey)
  dirtyScopes.add(scopeKey)
  if (!refusedScopes.has(scopeKey)) {
    console.warn('[native-chat-drafts] a draft could not be saved; it is kept in memory', error)
    refusedScopes.add(scopeKey)
    notifyScope(scopeKey)
  }
}

function persist(scopeKey: string): void {
  const record = records.get(scopeKey)
  const draft = record ? savedForm(record) : null
  const change: UnconfirmedDraftChange = { draft, at: draft?.savedAt ?? nextSavedAt() }
  let confirmedIds = draft?.journalEntryIds ?? []
  if (!draft) {
    try {
      confirmedIds = readNativeChatDraftJournalRecords()
        .filter(({ entry }) => entry.scopeKey === scopeKey)
        .map(nativeChatDraftJournalRecordId)
    } catch {
      /* Failed cleanup leaves recovery records intact. */
    }
  }
  unconfirmed.set(scopeKey, change)
  const storage = nativeChatComposerDraftStorage()
  const transform = pendingDraftTransforms.get(scopeKey)
  let appended: DraftRecord | null | undefined
  const operation = transform
    ? writeNativeChatComposerDraftTransaction(scopeKey, transform, record, (result) => {
        appended = result
        if (result) {
          confirmedIds = result.journalEntryIds ?? []
        }
      })
    : draft
      ? storage.write(scopeKey, draft)
      : storage.remove([scopeKey])
  const written = operation.then(
    () => {
      if (appended !== undefined && records.get(scopeKey) === record) {
        if (appended) {
          records.set(scopeKey, { ...record, ...appended })
        } else {
          records.delete(scopeKey)
        }
        notifyScope(scopeKey)
      }
      if (pendingDraftTransforms.get(scopeKey) === transform) {
        pendingDraftTransforms.delete(scopeKey)
      }
      confirm(scopeKey, change, confirmedIds)
      return true
    },
    (error: unknown) => {
      refuse(scopeKey, change, error)
      return false
    }
  )
  track(scopeKey, written)
}

function track(scopeKey: string, written: Promise<boolean>): void {
  inFlight.add(written)
  const pending = scopeWrites.get(scopeKey) ?? new Set()
  scopeWrites.set(scopeKey, pending)
  pending.add(written)
  void written.finally(() => {
    inFlight.delete(written)
    pending.delete(written)
    if (pending.size === 0 && scopeWrites.get(scopeKey) === pending) {
      scopeWrites.delete(scopeKey)
    }
  })
}

export function flushNativeChatComposerDrafts(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  for (const scopeKey of dirtyScopes) {
    dirtyScopes.delete(scopeKey)
    persist(scopeKey)
  }
}

/** Why: storage commits after this task, so what it has not confirmed when the window goes away
 *  is also written synchronously and replayed by the next load, a refused draft included. */
function journalUnconfirmed(): void {
  flushNativeChatComposerDrafts()
  journalNativeChatComposerDraftChanges(unconfirmed)
}

function journalWhenHidden(): void {
  if (document.visibilityState === 'hidden') {
    journalUnconfirmed()
  }
}

function installFlushOnHide(): void {
  if (
    flushOnHideInstalled ||
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function' ||
    typeof document === 'undefined'
  ) {
    return
  }
  flushOnHideInstalled = true
  window.addEventListener('pagehide', journalUnconfirmed)
  window.addEventListener('beforeunload', journalUnconfirmed)
  document.addEventListener('visibilitychange', journalWhenHidden)
}

/** Before the load lands, memory may not hold the saved draft, so an append is written onto what
 *  storage holds, read and written as one change. The loaded draft gets it again on landing. */
function appendBeforeLoad(scopeKey: string, append: DraftAppend): void {
  load.appendSequence += 1
  const entry: AppendBeforeLoad = { sequence: load.appendSequence, append, committed: false }
  load.appendsBeforeLoad.set(scopeKey, [...(load.appendsBeforeLoad.get(scopeKey) ?? []), entry])
  const owner = records.get(scopeKey)?.owner
  const appendedAt = records.get(scopeKey)?.savedAt ?? 0
  let committedIds: readonly string[] = []
  const empty: StoredNativeChatComposerDraft = { text: '', images: [], savedAt: 0 }
  const written = nativeChatComposerDraftStorage()
    .update(scopeKey, (stored) => {
      const base = parseStoredNativeChatComposerDraft(stored) ?? empty
      const next = savedForm({
        ...append({ ...base, ...(base.owner || !owner ? {} : { owner }) }),
        savedAt: nextSavedAt(base.savedAt + 1)
      })
      committedIds = next?.journalEntryIds ?? []
      return next
    })
    .then(
      () => {
        entry.committed = true
        pruneNativeChatComposerDraftJournal(scopeKey, appendedAt, committedIds)
        broadcastNativeChatComposerDraftChange(scopeKey)
        return true
      },
      (error: unknown) => {
        if (!refusedScopes.has(scopeKey)) {
          console.warn(
            '[native-chat-drafts] a draft could not be saved; it is kept in memory',
            error
          )
          refusedScopes.add(scopeKey)
          notifyScope(scopeKey)
        }
        return false
      }
    )
  track(scopeKey, written)
}

/** Marks a scope changed in memory: `deferred` coalesces typing into one write, `immediate`
 *  writes now. Before the startup load lands, an edit wins over the loaded draft and an append
 *  is applied again on top of it. */
export function persistNativeChatComposerDraft(
  scopeKey: string,
  timing: 'immediate' | 'deferred',
  append?: DraftAppend
): void {
  installFlushOnHide()
  if (!load.hydrated && append && !load.editedBeforeLoad.has(scopeKey)) {
    appendBeforeLoad(scopeKey, append)
    return
  }
  if (load.hydrated && append) {
    const pending = pendingDraftTransforms.get(scopeKey)
    pendingDraftTransforms.set(
      scopeKey,
      pending ? (base) => append(pending(base) ?? EMPTY_NATIVE_CHAT_STORED_DRAFT) : append
    )
    dirtyScopes.delete(scopeKey)
    persist(scopeKey)
    return
  }
  dirtyScopes.add(scopeKey)
  if (!load.hydrated) {
    load.editedBeforeLoad.add(scopeKey)
  }
  if (timing === 'immediate') {
    flushNativeChatComposerDrafts()
    return
  }
  flushTimer ??= setTimeout(flushNativeChatComposerDrafts, PERSIST_DEBOUNCE_MS)
}

export function persistNativeChatComposerDraftRecovery(
  scopeKey: string,
  transform: DraftTransform
): void {
  pendingDraftTransforms.set(scopeKey, transform)
  dirtyScopes.delete(scopeKey)
  persist(scopeKey)
}

/** A deletion also applies to drafts a load still in flight brings back. */
export function deleteLoadingNativeChatComposerDraftsWhere(
  matches: (scopeKey: string, draft: StoredNativeChatComposerDraft) => boolean
): void {
  if (!load.hydrated) {
    load.deletionsBeforeLoad.push(matches)
  }
}

/**
 * Settles once every write of this scope issued before the call has: true only when IndexedDB
 * completed each transaction, false when one was refused or failed. A change still waiting for its
 * deferred write is issued first, so it is included. Never settles on a timeout.
 */
export async function nativeChatComposerDraftWriteSettled(scopeKey: string): Promise<boolean> {
  if (dirtyScopes.has(scopeKey)) {
    flushNativeChatComposerDrafts()
  }
  const pending = scopeWrites.get(scopeKey)
  return pending ? (await Promise.all(pending)).every(Boolean) : true
}

/** Settles once every write issued so far has been confirmed or refused. */
export async function nativeChatComposerDraftWritesSettled(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled(inFlight)
  }
}

export function resetNativeChatComposerDraftPersistenceForTests(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  resetNativeChatComposerDraftBroadcastForTests()
  if (flushOnHideInstalled) {
    flushOnHideInstalled = false
    window.removeEventListener('pagehide', journalUnconfirmed)
    window.removeEventListener('beforeunload', journalUnconfirmed)
    document.removeEventListener('visibilitychange', journalWhenHidden)
  }
  inFlight.clear()
  scopeWrites.clear()
}
