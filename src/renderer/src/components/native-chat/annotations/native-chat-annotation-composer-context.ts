import { createContext, useContext, type ReactNode } from 'react'
import { useNativeChatHasAnnotations } from './use-native-chat-annotations'

export type NativeChatAnnotationComposer = {
  /** The conversation whose annotations the composer counts and sends with its message. */
  annotationScopeKey?: string
  /** The annotation review, drawn inside the composer above its attachments. */
  annotations: ReactNode
}

/** Provided by the chat's surface, so its composer reaches the conversation's annotations. */
export const NativeChatAnnotationComposerContext =
  createContext<NativeChatAnnotationComposer | null>(null)

export function useNativeChatAnnotationComposer(): NativeChatAnnotationComposer & {
  hasAnnotations: boolean
} {
  const value = useContext(NativeChatAnnotationComposerContext)
  const hasAnnotations = useNativeChatHasAnnotations(value?.annotationScopeKey)
  return {
    annotationScopeKey: value?.annotationScopeKey,
    annotations: value?.annotations,
    hasAnnotations
  }
}
