import { createBrowserUuid } from '@/lib/browser-uuid'
import { getNativeChatAnnotationsStore } from './native-chat-annotations-store'
import { formatNativeChatQuote } from './native-chat-quote-selection'
import {
  isNativeChatAnnotation,
  isNativeChatAnnotationEditor,
  nativeChatAnnotationEditorRevision,
  nativeChatAnnotationRevision
} from './native-chat-annotation-storage'
import type {
  NativeChatAnnotation,
  NativeChatAnnotationEditor,
  NativeChatAnnotationsSnapshot
} from './native-chat-annotations-store'

export type NativeChatAnnotationDelivery = {
  messageId: string
  notes: readonly NativeChatAnnotation[]
  editor?: NativeChatAnnotationEditor
  annotationText: string
  returned?: true
}

function isDelivery(value: unknown): value is NativeChatAnnotationDelivery {
  return (
    typeof value === 'object' &&
    value !== null &&
    'messageId' in value &&
    typeof value.messageId === 'string' &&
    value.messageId.length > 0 &&
    'notes' in value &&
    Array.isArray(value.notes) &&
    value.notes.every(isNativeChatAnnotation) &&
    'annotationText' in value &&
    typeof value.annotationText === 'string' &&
    (!('returned' in value) || value.returned === true) &&
    (!('editor' in value) || isNativeChatAnnotationEditor(value.editor))
  )
}

export function nativeChatAnnotationDeliveryStorage(scopeKey: string) {
  const prefix = `orca:native-chat-annotations:v2:${encodeURIComponent(scopeKey)}:delivery:`
  const quarantinePrefix = `orca:native-chat-annotations:v2:${encodeURIComponent(scopeKey)}:quarantine:`
  const keyFor = (id: string): string => `${prefix}${encodeURIComponent(id)}`
  return {
    read: (): NativeChatAnnotationDelivery[] => {
      const keys = Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index)
      )
      const deliveries: NativeChatAnnotationDelivery[] = []
      for (const key of keys) {
        if (!key?.startsWith(prefix)) {
          continue
        }
        const raw = localStorage.getItem(key)
        if (raw === null) {
          continue
        }
        let value: unknown
        try {
          value = JSON.parse(raw)
        } catch {
          value = undefined
        }
        if (isDelivery(value) && key === keyFor(value.messageId)) {
          deliveries.push(value)
        } else {
          localStorage.setItem(`${quarantinePrefix}delivery-${createBrowserUuid()}`, raw)
          if (localStorage.getItem(key) === raw) {
            localStorage.removeItem(key)
          }
        }
      }
      return deliveries
    },
    write: (delivery: NativeChatAnnotationDelivery): void =>
      localStorage.setItem(keyFor(delivery.messageId), JSON.stringify(delivery)),
    remove: (messageId: string): void => localStorage.removeItem(keyFor(messageId))
  }
}

export function withoutReservedNativeChatAnnotations(
  snapshot: NativeChatAnnotationsSnapshot,
  deliveries: readonly NativeChatAnnotationDelivery[]
): NativeChatAnnotationsSnapshot {
  const notes = new Set(
    deliveries
      .filter((delivery) => !delivery.returned)
      .flatMap((delivery) =>
        delivery.notes.map((note) => JSON.stringify([note.id, nativeChatAnnotationRevision(note)]))
      )
  )
  const editors = new Set(
    deliveries
      .filter((delivery) => !delivery.returned)
      .flatMap((delivery) =>
        delivery.editor ? [nativeChatAnnotationEditorRevision(delivery.editor)] : []
      )
  )
  const result = {
    ...snapshot,
    notes: snapshot.notes.filter(
      (note) => !notes.has(JSON.stringify([note.id, nativeChatAnnotationRevision(note)]))
    )
  }
  if (result.editor && editors.has(nativeChatAnnotationEditorRevision(result.editor))) {
    delete result.editor
  }
  return result
}

export function formatNativeChatAnnotations(
  notes: readonly Pick<NativeChatAnnotation, 'quote' | 'comment'>[]
): string {
  return notes
    .map((note) => `${formatNativeChatQuote(note.quote)}${note.comment.trim()}`)
    .join('\n\n')
}

export function prepareNativeChatAnnotatedMessage(scopeKey: string | undefined, text: string) {
  const store = getNativeChatAnnotationsStore(scopeKey)
  const { notes, editor } = store.getSnapshot()
  const entries = notes.map((note) =>
    note.id === editor?.id && editor.comment.trim() ? { ...note, comment: editor.comment } : note
  )
  if (editor?.comment.trim() && !notes.some((note) => note.id === editor.id)) {
    entries.push({ ...editor.anchor, id: '', createdAt: 0, comment: editor.comment })
  }
  const annotations = formatNativeChatAnnotations(entries)
  if (scopeKey) {
    try {
      for (const delivery of nativeChatAnnotationDeliveryStorage(scopeKey).read()) {
        if (
          delivery.returned &&
          delivery.annotationText &&
          entries.some(
            (entry) =>
              delivery.notes.some((note) => note.id === entry.id) ||
              (delivery.editor?.anchor.messageId === entry.messageId &&
                delivery.editor.anchor.startOffset === entry.startOffset &&
                delivery.editor.anchor.quote === entry.quote)
          ) &&
          text.trimEnd().endsWith(delivery.annotationText)
        ) {
          text = text.trimEnd().slice(0, -delivery.annotationText.length).trimEnd()
          break
        }
      }
    } catch {
      store.retryPersistence()
    }
  }
  return {
    hasAnnotations: entries.length > 0,
    text: annotations ? [text.trim(), annotations].filter(Boolean).join('\n\n') : text,
    consume: () => store.consume(notes, editor),
    reserve: (messageId: string) =>
      store.reserve({
        messageId,
        notes,
        annotationText: annotations,
        ...(editor ? { editor } : {})
      }),
    release: (messageId: string) => store.settleDelivery(messageId, 'returned')
  }
}
