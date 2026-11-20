import type { RefObject } from 'react'
import type { NativeChatComposerHandle } from '../composer/native-chat-composer-types'
import {
  readNativeChatAnnotationAnchor,
  type NativeChatAnnotationAnchor
} from './native-chat-annotation-anchor'
import type { NativeChatAnnotationNavigation } from './use-native-chat-annotation-locate'
import { useNativeChatAnnotationReview } from './use-native-chat-annotation-review'
import type { NativeChatAnnotationComposer } from './native-chat-annotation-composer-context'

/** The selection a right-click held, with the conversation it was in. */
export type NativeChatContextMenuAnnotation = {
  anchor: NativeChatAnnotationAnchor
  scopeKey: string
}

export type NativeChatContextMenuAnnotations = {
  begin: ((anchor: NativeChatAnnotationAnchor) => void) | undefined
  /** Reads the right-click's selection before the menu takes focus; undefined when none. */
  capture: () => NativeChatContextMenuAnnotation | undefined
  /** The menu row's action for a captured selection that is still in this conversation. */
  actionFor: (captured: NativeChatContextMenuAnnotation | undefined) => (() => void) | undefined
  composerProps: NativeChatAnnotationComposer
}

/** What a chat's context menu and selection offer need to start an annotation, and the composer's review. */
export function useNativeChatContextMenuAnnotations({
  scopeKey,
  rootRef,
  composerRef,
  messageListRef,
  enabled
}: {
  scopeKey: string | undefined
  rootRef: RefObject<HTMLElement | null>
  composerRef: RefObject<NativeChatComposerHandle | null>
  messageListRef?: RefObject<NativeChatAnnotationNavigation | null>
  enabled: boolean
}): NativeChatContextMenuAnnotations {
  const review = useNativeChatAnnotationReview({
    scopeKey,
    rootRef,
    composerRef,
    messageListRef,
    enabled
  })
  const { begin } = review
  return {
    begin,
    capture: () => {
      const anchor =
        scopeKey && rootRef.current ? readNativeChatAnnotationAnchor(rootRef.current) : null
      return anchor && scopeKey ? { anchor, scopeKey } : undefined
    },
    actionFor: (captured) =>
      captured && captured.scopeKey === scopeKey && begin
        ? () => begin(captured.anchor)
        : undefined,
    composerProps: { annotationScopeKey: scopeKey, annotations: review.tray }
  }
}
