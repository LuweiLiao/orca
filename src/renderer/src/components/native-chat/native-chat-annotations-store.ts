import { createBrowserUuid } from '@/lib/browser-uuid'
import type { NativeChatAnnotationAnchor } from './native-chat-annotation-anchor'
import { formatNativeChatQuote } from './native-chat-quote-selection'

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
  clear: () => boolean
  retryPersistence: () => boolean
}

const EMPTY: NativeChatAnnotationsSnapshot = { notes: [] }
const stores = new Map<string, NativeChatAnnotationsStore>()
const STORAGE_PREFIX = 'orca:native-chat-annotations:v1:'

function isAnchor(value: unknown): value is NativeChatAnnotationAnchor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'quote' in value &&
    typeof value.quote === 'string' &&
    value.quote.trim().length > 0 &&
    'messageId' in value &&
    typeof value.messageId === 'string' &&
    value.messageId.length > 0 &&
    'startOffset' in value &&
    typeof value.startOffset === 'number' &&
    Number.isSafeInteger(value.startOffset) &&
    value.startOffset >= 0
  )
}

function isNote(value: unknown): value is NativeChatAnnotation {
  return (
    isAnchor(value) &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'comment' in value &&
    typeof value.comment === 'string' &&
    value.comment.trim().length > 0 &&
    'createdAt' in value &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  )
}

function isEditor(value: unknown): value is NativeChatAnnotationEditor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'anchor' in value &&
    isAnchor(value.anchor) &&
    'comment' in value &&
    typeof value.comment === 'string' &&
    (!('id' in value) ||
      value.id === undefined ||
      (typeof value.id === 'string' && value.id.length > 0))
  )
}

function readSnapshot(key: string): NativeChatAnnotationsSnapshot {
  try {
    const stored = localStorage.getItem(key)
    if (stored === null) {
      return EMPTY
    }
    const value: unknown = JSON.parse(stored)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('notes' in value) ||
      !Array.isArray(value.notes) ||
      !value.notes.every(isNote) ||
      new Set(value.notes.map((note) => note.id)).size !== value.notes.length ||
      ('editor' in value && value.editor !== undefined && !isEditor(value.editor))
    ) {
      throw new Error('Saved annotations could not be read.')
    }
    return {
      notes: value.notes,
      ...('editor' in value && isEditor(value.editor) ? { editor: value.editor } : {})
    }
  } catch (error) {
    return { notes: [], persistenceError: errorMessage(error) }
  }
}

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
  clear: () => false,
  retryPersistence: () => false
}

export function getNativeChatAnnotationsStore(
  scopeKey: string | undefined
): NativeChatAnnotationsStore {
  if (scopeKey === undefined || scopeKey === '') {
    return disabledStore
  }
  const existing = stores.get(scopeKey)
  if (existing) {
    return existing
  }
  const key = `${STORAGE_PREFIX}${scopeKey}`
  let snapshot = readSnapshot(key)
  const listeners = new Set<() => void>()
  const publish = ({
    notes,
    editor
  }: Pick<NativeChatAnnotationsSnapshot, 'notes' | 'editor'>): boolean => {
    let persistenceError: string | undefined
    try {
      localStorage.setItem(key, JSON.stringify({ version: 1, notes, editor }))
    } catch (error) {
      persistenceError = errorMessage(error)
    }
    // Keep this copy across unmounts even when the browser cannot save it.
    snapshot = {
      notes,
      ...(editor === undefined ? {} : { editor }),
      ...(persistenceError === undefined ? {} : { persistenceError })
    }
    listeners.forEach((listener) => listener())
    return persistenceError === undefined
  }
  const store: NativeChatAnnotationsStore = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    add: (anchor, comment) => {
      if (!isAnchor(anchor) || !comment.trim()) {
        return null
      }
      const note: NativeChatAnnotation = {
        quote: anchor.quote,
        messageId: anchor.messageId,
        startOffset: anchor.startOffset,
        id: createBrowserUuid(),
        comment: comment.trim(),
        createdAt: Date.now()
      }
      publish({ ...snapshot, notes: [...snapshot.notes, note] })
      return note
    },
    update: (id, comment) => {
      if (!comment.trim() || !snapshot.notes.some((note) => note.id === id)) {
        return false
      }
      publish({
        ...snapshot,
        notes: snapshot.notes.map((note) =>
          note.id === id ? { ...note, comment: comment.trim() } : note
        )
      })
      return true
    },
    remove: (id) => {
      if (!snapshot.notes.some((note) => note.id === id)) {
        return false
      }
      publish({ ...snapshot, notes: snapshot.notes.filter((note) => note.id !== id) })
      return true
    },
    setEditor: (editor) => {
      if (editor !== undefined && !isEditor(editor)) {
        return false
      }
      publish({
        ...snapshot,
        editor: editor === undefined ? undefined : { ...editor, anchor: { ...editor.anchor } }
      })
      return true
    },
    clear: () => {
      publish({ notes: [] })
      return true
    },
    retryPersistence: () => publish(snapshot)
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
