import { useEffect, useId, useMemo, useSyncExternalStore, type RefObject } from 'react'
import { createDomTextSearchHighlights } from '@/lib/text-search/dom-text-search-highlights'
import { resolveNativeChatAnnotationRange } from './native-chat-annotation-anchor'
import {
  getNativeChatAnnotationsStore,
  type NativeChatAnnotation
} from './native-chat-annotations-store'

export type {
  NativeChatAnnotation,
  NativeChatAnnotationAnchor,
  NativeChatAnnotationEditor
} from './native-chat-annotations-store'

export function useNativeChatAnnotations(scopeKey: string | undefined) {
  const store = getNativeChatAnnotationsStore(scopeKey)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return {
    ...snapshot,
    add: store.add,
    update: store.update,
    remove: store.remove,
    setEditor: store.setEditor,
    clear: store.clear,
    consume: store.consume,
    retryPersistence: store.retryPersistence
  }
}

/** Saved annotations, or a typed one being edited, make the composer's Send deliver them. */
export function useNativeChatHasAnnotations(scopeKey: string | undefined): boolean {
  const { notes, editor } = useNativeChatAnnotations(scopeKey)
  return notes.length > 0 || Boolean(editor?.comment.trim())
}

export function useNativeChatAnnotationHighlights(
  rootRef: RefObject<HTMLElement | null>,
  notes: readonly NativeChatAnnotation[],
  enabled = true
): string {
  const id = useId()
  const name = `native-chat-annotation-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const highlights = useMemo(
    () => createDomTextSearchHighlights({ match: name, active: `${name}-active` }),
    [name]
  )
  useEffect(() => {
    const root = rootRef.current
    if (!root || !enabled || notes.length === 0) {
      return
    }
    const instance = {}
    const paint = (): void => {
      const ranges = notes.flatMap((note) => {
        const range = resolveNativeChatAnnotationRange(root, note)
        return range ? [range] : []
      })
      highlights.setMatches(instance, ranges)
    }
    paint()
    const observer = new MutationObserver(paint)
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'data-native-chat-message-id',
        'data-native-chat-annotation-message-id',
        'data-native-chat-quote-source'
      ]
    })
    return () => {
      observer.disconnect()
      highlights.clear(instance)
    }
  }, [rootRef, notes, enabled, highlights])
  return name
}
