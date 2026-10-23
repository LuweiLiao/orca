import type {
  NativeChatAnnotation,
  NativeChatAnnotationAnchor,
  NativeChatAnnotationEditor,
  NativeChatAnnotationsSnapshot
} from './native-chat-annotations-store'

export function isNativeChatAnnotationAnchor(value: unknown): value is NativeChatAnnotationAnchor {
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
    isNativeChatAnnotationAnchor(value) &&
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

export function isNativeChatAnnotationEditor(value: unknown): value is NativeChatAnnotationEditor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'anchor' in value &&
    isNativeChatAnnotationAnchor(value.anchor) &&
    'comment' in value &&
    typeof value.comment === 'string' &&
    (!('id' in value) ||
      value.id === undefined ||
      (typeof value.id === 'string' && value.id.length > 0))
  )
}

export function nativeChatAnnotationStorage(scopeKey: string) {
  const legacyKey = `orca:native-chat-annotations:v1:${scopeKey}`
  const prefix = `orca:native-chat-annotations:v2:${encodeURIComponent(scopeKey)}:`
  const noteKey = (id: string): string => `${prefix}note:${encodeURIComponent(id)}`
  const editorKey = `${prefix}editor`
  const migrate = (): void => {
    const stored = localStorage.getItem(legacyKey)
    if (stored === null) {
      return
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
      ('editor' in value &&
        value.editor !== undefined &&
        !isNativeChatAnnotationEditor(value.editor))
    ) {
      throw new Error('Saved annotations could not be read.')
    }
    for (const note of value.notes) {
      if (localStorage.getItem(noteKey(note.id)) === null) {
        localStorage.setItem(noteKey(note.id), JSON.stringify(note))
      }
    }
    if (
      'editor' in value &&
      value.editor !== undefined &&
      localStorage.getItem(editorKey) === null
    ) {
      localStorage.setItem(editorKey, JSON.stringify(value.editor))
    }
    localStorage.removeItem(legacyKey)
  }
  return {
    matches: (key: string | null): boolean =>
      key === null || key === legacyKey || key.startsWith(prefix),
    read: (): NativeChatAnnotationsSnapshot => {
      migrate()
      const keys = Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index)
      )
      const notes: NativeChatAnnotation[] = []
      for (const key of keys) {
        if (!key?.startsWith(`${prefix}note:`)) {
          continue
        }
        const stored = localStorage.getItem(key)
        if (stored === null) {
          continue
        }
        const note: unknown = JSON.parse(stored)
        if (!isNote(note) || key !== noteKey(note.id)) {
          throw new Error('Saved annotations could not be read.')
        }
        notes.push(note)
      }
      notes.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      const storedEditor = localStorage.getItem(editorKey)
      const editor: unknown = storedEditor === null ? undefined : JSON.parse(storedEditor)
      if (editor !== undefined && !isNativeChatAnnotationEditor(editor)) {
        throw new Error('Saved annotations could not be read.')
      }
      return { notes, ...(editor === undefined ? {} : { editor }) }
    },
    writeNote: (id: string, note: NativeChatAnnotation | null): void => {
      if (note === null) {
        localStorage.removeItem(noteKey(id))
      } else {
        localStorage.setItem(noteKey(id), JSON.stringify(note))
      }
    },
    writeEditor: (editor: NativeChatAnnotationEditor | undefined): void => {
      if (editor === undefined) {
        localStorage.removeItem(editorKey)
      } else {
        localStorage.setItem(editorKey, JSON.stringify(editor))
      }
    }
  }
}
