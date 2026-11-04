import { useCallback, useImperativeHandle, type ForwardedRef } from 'react'
import { appendNativeChatDraftCache, readNativeChatDraftCache } from './native-chat-draft-cache'
import { requestNativeChatComposerSend } from './native-chat-composer-send-request'
import type { ClipboardEventLike } from './native-chat-clipboard-payload'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import {
  useNativeChatComposerPaste,
  type UseNativeChatComposerPasteArgs
} from './use-native-chat-composer-paste'
import { useNativeChatTypedInsertion } from './use-native-chat-typed-insertion'
import { useNativeChatPastedTextFile } from './use-native-chat-pasted-text-file'
import type { NativeChatComposerInput } from './native-chat-composer-input'

type UseNativeChatComposerHandleArgs = Parameters<typeof useNativeChatTypedInsertion>[0] &
  Omit<UseNativeChatComposerPasteArgs, 'insertTypedText'> & {
    /** Intake only: captured with the paste action, never consulted during settlement. */
    pastesInline: () => boolean
    /** A structured chat's editor while it shows this scope, where a long paste saved as a file lands. */
    pastedTextEditor: (() => NativeChatComposerInput | null) | null
  }

/** Typed and pasted insertion for the composer, exposed on the handle the chat
 *  root uses to route keystrokes and pastes into it. Returns the paste handler. */
export function useNativeChatComposerHandle(
  ref: ForwardedRef<NativeChatComposerHandle>,
  args: UseNativeChatComposerHandleArgs
): (event: ClipboardEventLike) => void {
  const { textareaRef, isComposing, setDraft, setCaret, setActiveSuggestion, ...pasteArgs } = args
  const { insertTypedText, appendText, acceptsText, insertPastedText, focus, contains } =
    useNativeChatTypedInsertion({
      textareaRef,
      isComposing,
      setDraft,
      setCaret,
      setActiveSuggestion
    })

  const insertPastedTextOrFile = useNativeChatPastedTextFile({
    pastesInline: args.pastesInline,
    scopeKey: args.attachmentScopeKey ?? '',
    // Without a draft scope there is no draft for a pending paste to settle in.
    scopeEditor: args.attachmentScopeKey ? args.pastedTextEditor : null,
    resolveAttachmentOwner: args.resolveAttachmentOwner,
    insertTypedText: insertPastedText,
    setNotice: args.setNotice
  })
  const { handlePaste: handlePasteEvent, pasteFromClipboard } = useNativeChatComposerPaste({
    ...pasteArgs,
    setCaret,
    insertTypedText: insertPastedTextOrFile
  })

  const appendTextDurably = useCallback(
    (text: string): boolean => {
      if (!args.attachmentScopeKey || !acceptsText()) {
        return false
      }
      return appendNativeChatDraftCache(args.attachmentScopeKey, text)
    },
    [acceptsText, args.attachmentScopeKey]
  )

  const appendTextAndSend = useCallback(
    (text: string): void => {
      const scopeKey = args.attachmentScopeKey
      const wasEmpty = textareaRef.current?.value.trim() === ''
      appendText(text)
      if (scopeKey && wasEmpty) {
        requestNativeChatComposerSend(scopeKey, readNativeChatDraftCache(scopeKey))
      }
    },
    [appendText, args.attachmentScopeKey, textareaRef]
  )

  useImperativeHandle(
    ref,
    () => ({
      insertSkill: (token, path) => {
        const input = textareaRef.current
        if (!input || input.disabled || isComposing() || !input.insertSkill) {
          return false
        }
        const at = input.selectionStart ?? input.value.length
        input.insertSkill(at, input.selectionEnd ?? at, token, path)
        setDraft(input.value)
        setCaret(input.selectionStart ?? input.value.length)
        input.focus()
        return true
      },
      focus,
      insertTypedText,
      acceptsText,
      appendText,
      appendTextAndSend,
      appendTextDurably,
      handlePasteEvent,
      pasteFromClipboard,
      contains
    }),
    [
      isComposing,
      setDraft,
      setCaret,
      textareaRef,
      focus,
      insertTypedText,
      acceptsText,
      appendText,
      appendTextAndSend,
      appendTextDurably,
      handlePasteEvent,
      pasteFromClipboard,
      contains
    ]
  )
  return handlePasteEvent
}
