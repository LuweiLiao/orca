import { createBrowserUuid } from '@/lib/browser-uuid'
import type { NativeChatAnnotationAnchor } from './native-chat-annotation-anchor'
import { formatNativeChatQuote } from './native-chat-quote-selection'
import {
  isNativeChatAnnotationAnchor,
  isNativeChatAnnotationEditor,
  nativeChatAnnotationStorage
} from './native-chat-annotation-storage'

export type { NativeChatAnnotationAnchor } from './native-chat-annotation-anchor'

export type NativeChatAnnotation = NativeChatAnnotationAnchor & {
  id: string
  comment: string
  createdAt: number
}

export type NativeChatAnnotationEditor = {
  anchor: NativeChatAnnotationAnchor
  id?: string
  comment: string
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
  const pending = new Map<string, NativeChatAnnotation | null>()
  let pendingEditor: { value: NativeChatAnnotationEditor | undefined } | undefined
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
      if (note === null) {
        notes.delete(id)
      } else {
        notes.set(id, note)
      }
    }
    next = {
      ...next,
      notes: [...notes.values()].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
      ),
      ...(pendingEditor ? { editor: pendingEditor.value } : {}),
      ...((pending.size > 0 || pendingEditor) && snapshot.persistenceError
        ? { persistenceError: snapshot.persistenceError }
        : {})
    }
    if (next.editor === undefined) {
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
      storage.read()
      for (const [id, note] of pending) {
        storage.writeNote(id, note)
        pending.delete(id)
      }
      if (pendingEditor) {
        storage.writeEditor(pendingEditor.value)
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
      const current = snapshot.notes.find((entry) => entry.id === note.id)
      if (JSON.stringify(current) === JSON.stringify(note)) {
        pending.set(note.id, null)
      }
    }
    if (editor && JSON.stringify(snapshot.editor) === JSON.stringify(editor)) {
      pendingEditor = { value: undefined }
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
      pending.set(id, { ...note, comment: comment.trim() })
      persist()
      return true
    },
    remove: (id) => {
      refresh()
      if (!snapshot.notes.some((note) => note.id === id)) {
        return false
      }
      pending.set(id, null)
      persist()
      return true
    },
    setEditor: (editor) => {
      if (editor !== undefined && !isNativeChatAnnotationEditor(editor)) {
        return false
      }
      pendingEditor = { value: editor }
      persist()
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
