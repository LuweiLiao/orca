import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import { readConversationReferenceDrag } from '@/lib/conversation-reference-drag'
import {
  CONVERSATION_REFERENCE_DRAG_TYPE,
  conversationReferenceToken
} from '../../../../shared/conversation-reference'
import type { NativeChatComposerInput } from './native-chat-composer-input'
import {
  readNativeChatComposerDraft,
  updateNativeChatComposerDraft
} from './native-chat-composer-draft-store'

export function useConversationReferenceDrop(
  scope: string,
  input: RefObject<NativeChatComposerInput | null>,
  disabled: boolean,
  composing: () => boolean,
  targetEnvironmentId?: string
) {
  const [pending, setPending] = useState(0)
  const [hover, setHover] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const hasReference = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer.types).includes(CONVERSATION_REFERENCE_DRAG_TYPE)
  return {
    pending: pending > 0,
    hover,
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!hasReference(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = disabled || composing() ? 'none' : 'copy'
      setHover(!disabled && !composing())
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !event.currentTarget.contains(event.relatedTarget)
      ) {
        setHover(false)
      }
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (!hasReference(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setHover(false)
      if (disabled || composing()) {
        return
      }
      const source = readConversationReferenceDrag(event.dataTransfer)
      if (!source) {
        return
      }
      if (
        targetEnvironmentId &&
        source.executionHostId !== toRuntimeExecutionHostId(targetEnvironmentId)
      ) {
        toast.error(
          translate(
            'components.native-chat.conversationReference.differentHost',
            'This agent cannot reach the conversation on its source host. Open the chat on that host to reference it.'
          )
        )
        return
      }
      const target = input.current
      setPending((count) => count + 1)
      void window.api.aiVault
        .createConversationReference(source)
        .then((reference) => {
          const token = `${conversationReferenceToken(reference)} `
          if (mounted.current && input.current === target && target && !composing()) {
            target.focus()
            target.insertText?.(token)
          } else {
            const draft = readNativeChatComposerDraft(scope)
            updateNativeChatComposerDraft(
              scope,
              { text: `${draft.text}${draft.text ? ' ' : ''}${token}`, document: undefined },
              'immediate'
            )
          }
        })
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error))
        )
        .finally(() => {
          if (mounted.current) {
            setPending((count) => count - 1)
          }
        })
    }
  }
}
