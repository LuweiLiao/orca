import { useCallback } from 'react'
import type { RefObject } from 'react'
import type { NativeChatComposerInput } from './native-chat-composer-input'
import type { OrchestrationAgentSelection } from './native-chat-orchestration-instruction'

export function useNativeChatOrchestrationInsert(
  inputRef: RefObject<NativeChatComposerInput | null>,
  setCaret: (value: number) => void
): (selections: OrchestrationAgentSelection[]) => boolean {
  return useCallback(
    (selections) => {
      const input = inputRef.current
      if (!input || input.disabled || !input.insertOrchestration || selections.length === 0) {
        return false
      }
      input.focus()
      input.insertOrchestration(selections)
      setCaret(input.selectionStart)
      return true
    },
    [inputRef, setCaret]
  )
}
