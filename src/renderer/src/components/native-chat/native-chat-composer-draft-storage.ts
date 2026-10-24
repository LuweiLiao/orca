// The stored form of composer drafts and the storage they live in. Drafts are kept in their own
// store (IndexedDB), not localStorage, so they never compete with other saved state for its quota
// and need no budget: every draft comes back.

import type { JSONContent } from '@tiptap/react'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { createIndexedDbNativeChatComposerDraftStorage } from './native-chat-composer-draft-indexeddb'
import type { NativeChatComposerDraftAddition } from './native-chat-composer-draft-addition'

export type NativeChatComposerDraftJournalAddition = {
  readonly id: string
  readonly addition: NativeChatComposerDraftAddition
}

export type NativeChatComposerDraftImage = {
  id: string
  /** Empty for an image Orca could not keep. */
  path: string
  connectionId?: string
  /** Set on an image Orca could not keep: the file name the user must attach again. */
  unavailableName?: string
}

export type NativeChatComposerDraft = {
  readonly text: string
  readonly pastedTextFiles?: Readonly<Record<string, string>>
  /** The editor's document for exactly `text`; dropped when the text changes without one. */
  readonly document?: JSONContent
  readonly images: readonly NativeChatComposerDraftImage[]
}

/** The workspace whose chat the draft was written in; its removal deletes the draft. */
export type NativeChatComposerDraftOwner = {
  readonly workspaceId: string
  readonly executionHostId: ExecutionHostId
}

export type StoredNativeChatComposerDraft = NativeChatComposerDraft & {
  readonly savedAt: number
  readonly owner?: NativeChatComposerDraftOwner
  readonly journalEntryIds?: readonly string[]
  readonly journalAdditions?: readonly NativeChatComposerDraftJournalAddition[]
  readonly editRevision?: string
}

/** Where drafts are kept. Every write and removal settles once storage has committed it, and
 *  rejects when storage refused it. */
export type NativeChatComposerDraftStorage = {
  loadAll(): Promise<ReadonlyMap<string, unknown>>
  read(scopeKey: string): Promise<unknown>
  write(scopeKey: string, draft: StoredNativeChatComposerDraft): Promise<void>
  remove(scopeKeys: readonly string[]): Promise<void>
  /** Reads the stored record and writes what `apply` makes of it, as one change. */
  update(
    scopeKey: string,
    apply: (stored: unknown) => StoredNativeChatComposerDraft | null
  ): Promise<void>
}

/** Drafts kept for this run only: the storage of an environment without IndexedDB (unit tests),
 *  and the fake those tests drive. */
export function createMemoryNativeChatComposerDraftStorage(): NativeChatComposerDraftStorage & {
  readonly drafts: Map<string, StoredNativeChatComposerDraft>
  refuseWrites: boolean
} {
  const drafts = new Map<string, StoredNativeChatComposerDraft>()
  const storage = {
    drafts,
    refuseWrites: false,
    loadAll: async () => new Map(drafts),
    read: async (scopeKey: string) => drafts.get(scopeKey),
    write: (scopeKey: string, draft: StoredNativeChatComposerDraft) => {
      if (storage.refuseWrites) {
        return Promise.reject(new DOMException('refused', 'QuotaExceededError'))
      }
      drafts.set(scopeKey, draft)
      return Promise.resolve()
    },
    remove: (scopeKeys: readonly string[]) => {
      for (const scopeKey of scopeKeys) {
        drafts.delete(scopeKey)
      }
      return Promise.resolve()
    },
    update: (
      scopeKey: string,
      apply: (stored: unknown) => StoredNativeChatComposerDraft | null
    ) => {
      if (storage.refuseWrites) {
        return Promise.reject(new DOMException('refused', 'QuotaExceededError'))
      }
      const next = apply(drafts.get(scopeKey))
      if (next) {
        drafts.set(scopeKey, next)
      } else {
        drafts.delete(scopeKey)
      }
      return Promise.resolve()
    }
  }
  return storage
}

let storage: NativeChatComposerDraftStorage | null = null

export function nativeChatComposerDraftStorage(): NativeChatComposerDraftStorage {
  storage ??=
    typeof indexedDB === 'undefined'
      ? createMemoryNativeChatComposerDraftStorage()
      : createIndexedDbNativeChatComposerDraftStorage(indexedDB)
  return storage
}

export function setNativeChatComposerDraftStorageForTests(
  next: NativeChatComposerDraftStorage | null
): void {
  storage = next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Only the editor's own root node is restored; anything else falls back to the plain text. */
function isEditorDocument(value: unknown): value is JSONContent {
  return isRecord(value) && value.type === 'doc'
}

function parseImage(value: unknown): NativeChatComposerDraftImage | null {
  if (!isRecord(value)) {
    return null
  }
  const { id, path, connectionId, unavailableName } = value
  if (typeof id !== 'string') {
    return null
  }
  if (typeof unavailableName === 'string') {
    return { id, path: '', unavailableName }
  }
  if (typeof path !== 'string' || path === '') {
    return null
  }
  return { id, path, ...(typeof connectionId === 'string' ? { connectionId } : {}) }
}

function parseOwner(value: unknown): NativeChatComposerDraftOwner | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const { workspaceId, executionHostId } = value
  const host = typeof executionHostId === 'string' ? parseExecutionHostId(executionHostId) : null
  return typeof workspaceId === 'string' && host
    ? { workspaceId, executionHostId: host.id }
    : undefined
}

export function parseNativeChatComposerDraftAddition(
  value: unknown
): NativeChatComposerDraftAddition | null {
  if (!isRecord(value)) {
    return null
  }
  const { text, images, before, fills, fromUser } = value
  if (text !== undefined && typeof text !== 'string') {
    return null
  }
  if (images !== undefined && !Array.isArray(images)) {
    return null
  }
  return {
    ...(typeof text === 'string' ? { text } : {}),
    ...(Array.isArray(images)
      ? { images: images.flatMap((image) => parseImage(image) ?? []) }
      : {}),
    ...(typeof before === 'string' ? { before } : {}),
    ...(Array.isArray(fills) ? { fills: fills.filter((id) => typeof id === 'string') } : {}),
    ...(fromUser === true ? { fromUser: true } : {})
  }
}

function parseJournalAdditions(
  value: unknown
): NativeChatComposerDraftJournalAddition[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.flatMap((entry): NativeChatComposerDraftJournalAddition[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      return []
    }
    const addition = parseNativeChatComposerDraftAddition(entry.addition)
    return addition ? [{ id: entry.id, addition }] : []
  })
}

/** A stored value as a draft, or null when it isn't one (a newer or damaged record). */
export function parseStoredNativeChatComposerDraft(
  value: unknown
): StoredNativeChatComposerDraft | null {
  if (!isRecord(value)) {
    return null
  }
  const { text, document, images, savedAt } = value
  if (typeof text !== 'string' || typeof savedAt !== 'number' || !Array.isArray(images)) {
    return null
  }
  const pastedTextFiles = isRecord(value.pastedTextFiles)
    ? Object.fromEntries(
        Object.entries(value.pastedTextFiles).flatMap(([id, path]): [string, string][] =>
          /^[0-9a-f-]{36}$/.test(id) &&
          typeof path === 'string' &&
          path !== '' &&
          text.includes(`[Pasted text](orca-paste:${id})`)
            ? [[id, path]]
            : []
        )
      )
    : undefined
  const owner = parseOwner(value.owner)
  const journalAdditions = parseJournalAdditions(value.journalAdditions)
  return {
    text,
    ...(pastedTextFiles ? { pastedTextFiles } : {}),
    ...(isEditorDocument(document) ? { document } : {}),
    images: images.flatMap((image) => parseImage(image) ?? []),
    savedAt,
    ...(typeof value.editRevision === 'string' ? { editRevision: value.editRevision } : {}),
    ...(journalAdditions ? { journalAdditions } : {}),
    ...(Array.isArray(value.journalEntryIds) &&
    value.journalEntryIds.every((id) => typeof id === 'string')
      ? { journalEntryIds: [...new Set(value.journalEntryIds)] }
      : {}),
    ...(owner ? { owner } : {})
  }
}

const LEGACY_LOCAL_STORAGE_PREFIX = 'orca:nativeChatComposerDraft:v1:'

/** Drafts this change kept in localStorage before it moved them; never released, so they go. */
export function removeLegacyLocalStorageNativeChatComposerDrafts(): void {
  try {
    const keys: string[] = []
    for (let position = 0; position < localStorage.length; position += 1) {
      const key = localStorage.key(position)
      if (key?.startsWith(LEGACY_LOCAL_STORAGE_PREFIX)) {
        keys.push(key)
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key)
    }
  } catch {
    // No localStorage: nothing was kept there either.
  }
}
