import type { JSONContent } from '@tiptap/react'
import {
  ORCHESTRATION_REFERENCE_NODE,
  type OrchestrationAgentSelection
} from '../../../../shared/native-chat-orchestration-reference'
import { nativeChatOrchestrationSelection } from './native-chat-orchestration-instruction'

/**
 * The assignment pills in a composer document: what the person picked or inserted, sent beside
 * the text so the host knows which cards came from the composer and not from typed text.
 */
export function promptOrchestrationCards(
  document: JSONContent | undefined
): OrchestrationAgentSelection[] {
  if (!document) {
    return []
  }
  const own =
    document.type === ORCHESTRATION_REFERENCE_NODE && document.attrs
      ? nativeChatOrchestrationSelection(document.attrs)
      : null
  return [
    ...(own ? [own] : []),
    ...(document.content ?? []).flatMap((child) => promptOrchestrationCards(child))
  ]
}
