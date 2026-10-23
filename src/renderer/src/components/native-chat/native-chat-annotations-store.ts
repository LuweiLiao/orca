import { createBrowserUuid } from '@/lib/browser-uuid'
import type { NativeChatAnnotationAnchor } from './native-chat-annotation-anchor'
import { formatNativeChatQuote } from './native-chat-quote-selection'
import {
  isNativeChatAnnotationAnchor,
  isNativeChatAnnotationEditor,
  nativeChatAnnotationRevision,
  nativeChatAnnotationEditorRevision,
  nativeChatAnnotationStorage
} from './native-chat-annotation-storage'

export type { NativeChatAnnotationAnchor } from './native-chat-annotation-anchor'

export type NativeChatAnnotation = NativeChatAnnotationAnchor & {
  id: string
  comment: string
  createdAt: number
  revision?: string
}

export type NativeChatAnnotationEditor = {
  anchor: NativeChatAnnotationAnchor
  id?: string
  comment: string
  revision?: string
}

export type NativeChatAnnotationsSnapshot = {
  notes: readonly NativeChatAnnotation[]
  editor?: NativeChatAnnotationEditor
  persistenceError?: string
}

export type NativeChatAnnotationsStore = {
  getSnapshot: () => NativeChatAnnotationsSnapshot
  subscribe: (listener: () => void) => () => void
  add: (anchor: NativeChatAnnotationAnchor, comment: string) => NativeChatAnnotation | null
  update: (id: string, comment: string) => boolean
  remove: (id: string) => boolean
  setEditor: (editor: NativeChatAnnotationEditor | undefined) => boolean
  consume: (notes: readonly NativeChatAnnotation[], editor?: NativeChatAnnotationEditor) => boolean
  clear: () => boolean
  retryPersistence: () => boolean
}

const EMPTY: NativeChatAnnotationsSnapshot = { notes: [] }
const stores = new Map<string, NativeChatAnnotationsStore>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Annotations could not be saved.'
}

const disabledStore: NativeChatAnnotationsStore = {
  getSnapshot: () => EMPTY,
  subscribe: () => () => {},
  add: () => null,
  update: () => false,
  remove: () => false,
  setEditor: () => false,
  consume: () => false,
  clear: () => false,
  retryPersistence: () => false
}

export function getNativeChatAnnotationsStore(
  scopeKey: string | undefined
): NativeChatAnnotationsStore {
  if (!scopeKey) {
    return disabledStore
  }
  const existing = stores.get(scopeKey)
  if (existing) {
    return existing
  }
  const storage = nativeChatAnnotationStorage(scopeKey)
  let snapshot = EMPTY
  const pending = new Map<string, NativeChatAnnotation>()
  const consumedNotes = new Map<string, NativeChatAnnotation>()
  const consumedEditors = new Map<string, NativeChatAnnotationEditor>()
  let pendingEditor: NativeChatAnnotationEditor | undefined
  const listeners = new Set<() => void>()
  const refresh = (): void => {
    let next: NativeChatAnnotationsSnapshot
    try {
      next = storage.read()
    } catch (error) {
      next = { ...snapshot, persistenceError: errorMessage(error) }
    }
    const notes = new Map(next.notes.map((note) => [note.id, note]))
    for (const [id, note] of pending) {
      notes.set(id, note)
    }
    for (const note of consumedNotes.values()) {
      const current = notes.get(note.id)
      if (current && nativeChatAnnotationRevision(current) === nativeChatAnnotationRevision(note)) {
        notes.delete(note.id)
      }
    }
    next = {
      ...next,
      notes: [...notes.values()].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
      ),
      ...(pendingEditor ? { editor: pendingEditor } : {}),
      ...((pending.size > 0 ||
        pendingEditor ||
        consumedNotes.size > 0 ||
        consumedEditors.size > 0) &&
      snapshot.persistenceError
        ? { persistenceError: snapshot.persistenceError }
        : {})
    }
    if (
      next.editor === undefined ||
      consumedEditors.has(nativeChatAnnotationEditorRevision(next.editor))
    ) {
      delete next.editor
    }
    if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
      snapshot = next
      listeners.forEach((listener) => listener())
    }
  }
  const persist = (): boolean => {
    try {
      // Migrate before mutating; a failed migration must leave the legacy copy intact.
      const saved = storage.read()
      if (saved.persistenceError) {
        throw new Error(saved.persistenceError)
      }
      for (const [id, note] of pending) {
        storage.writeNote(note)
        pending.delete(id)
      }
      for (const [revision, note] of consumedNotes) {
        storage.consumeNote(note)
        consumedNotes.delete(revision)
      }
      for (const [revision, editor] of consumedEditors) {
        storage.consumeEditor(editor)
        consumedEditors.delete(revision)
      }
      if (pendingEditor) {
        storage.writeEditor(pendingEditor)
        pendingEditor = undefined
      }
      refresh()
      return true
    } catch (error) {
      refresh()
      snapshot = { ...snapshot, persistenceError: errorMessage(error) }
      listeners.forEach((listener) => listener())
      return false
    }
  }
  const consume: NativeChatAnnotationsStore['consume'] = (notes, editor) => {
    refresh()
    for (const note of notes) {
      const unconfirmed = pending.get(note.id)
      if (
        unconfirmed &&
        nativeChatAnnotationRevision(unconfirmed) === nativeChatAnnotationRevision(note)
      ) {
        pending.delete(note.id)
      }
      consumedNotes.set(JSON.stringify([note.id, nativeChatAnnotationRevision(note)]), note)
    }
    if (editor) {
      if (
        pendingEditor &&
        nativeChatAnnotationEditorRevision(pendingEditor) ===
          nativeChatAnnotationEditorRevision(editor)
      ) {
        pendingEditor = undefined
      }
      consumedEditors.set(nativeChatAnnotationEditorRevision(editor), editor)
    }
    return persist()
  }
  const onStorage = (event: StorageEvent): void => {
    if (storage.matches(event.key)) {
      refresh()
    }
  }
  refresh()
  const store: NativeChatAnnotationsStore = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (listeners.size === 0) {
        window.addEventListener('storage', onStorage)
        refresh()
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          window.removeEventListener('storage', onStorage)
        }
      }
    },
    add: (anchor, comment) => {
      if (!isNativeChatAnnotationAnchor(anchor) || !comment.trim()) {
        return null
      }
      refresh()
      const note: NativeChatAnnotation = {
        ...anchor,
        id: createBrowserUuid(),
        revision: createBrowserUuid(),
        comment: comment.trim(),
        createdAt: Math.max(Date.now(), ...snapshot.notes.map((note) => note.createdAt + 1))
      }
      pending.set(note.id, note)
      persist()
      return note
    },
    update: (id, comment) => {
      refresh()
      const note = snapshot.notes.find((entry) => entry.id === id)
      if (!note || !comment.trim()) {
        return false
      }
      pending.set(id, { ...note, comment: comment.trim(), revision: createBrowserUuid() })
      persist()
      return true
    },
    remove: (id) => {
      refresh()
      const note = snapshot.notes.find((entry) => entry.id === id)
      if (!note) {
        return false
      }
      consume([note])
      return true
    },
    setEditor: (editor) => {
      if (editor !== undefined && !isNativeChatAnnotationEditor(editor)) {
        return false
      }
      if (editor === undefined) {
        refresh()
        consume([], snapshot.editor)
      } else {
        pendingEditor = { ...editor, anchor: { ...editor.anchor }, revision: createBrowserUuid() }
        persist()
      }
      return true
    },
    consume,
    clear: () => {
      refresh()
      return consume(snapshot.notes, snapshot.editor)
    },
    retryPersistence: persist
  }
  stores.set(scopeKey, store)
  return store
}

export function formatNativeChatAnnotations(
  notes: readonly Pick<NativeChatAnnotation, 'quote' | 'comment'>[]
): string {
  return notes
    .map((note) => `${formatNativeChatQuote(note.quote)}${note.comment.trim()}`)
    .join('\n\n')
}
