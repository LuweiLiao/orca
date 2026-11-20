import { useCallback } from 'react'
import type { RefObject } from 'react'
import type { NativeChatComposerInput } from '../composer/editor/native-chat-composer-input'
import {
  nativeChatOrchestrationAttributes,
  nativeChatOrchestrationSeparator,
  type OrchestrationAgentSelection
} from './native-chat-orchestration-instruction'

/** Inserts picked assignment cards at the caret; their tokens come back as pills in the editor. */
export function useNativeChatOrchestrationInsert(
  inputRef: RefObject<NativeChatComposerInput | null>,
  setCaret: (value: number) => void
): (selections: OrchestrationAgentSelection[]) => boolean {
  return useCallback(
    (selections) => {
      const input = inputRef.current
      if (!input || input.disabled || !input.insertText || selections.length === 0) {
        return false
      }
      input.focus()
      input.insertText(
        selections
          .map((selection) => nativeChatOrchestrationAttributes(selection).token)
          .join(nativeChatOrchestrationSeparator())
      )
      setCaret(input.selectionStart)
      return true
    },
    [inputRef, setCaret]
  )
}
