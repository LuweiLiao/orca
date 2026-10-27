import type { ConversationReferenceCreate } from '../../../../shared/conversation-reference'
import { CONVERSATION_REFERENCE_DRAG_TYPE } from '../../../../shared/conversation-reference'
import {
  addConversationReferenceToComposer,
  conversationReferenceComposerWithin
} from '@/components/native-chat/conversation-reference-insertion'

const WAIT_FOR_COMPOSER_MS = 5000

export function carriesConversationReference(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(CONVERSATION_REFERENCE_DRAG_TYPE)
}

/**
 * Puts a dropped reference in the composer of the chat window the drop just opened. The window
 * mounts on the next render and its composer a little later, so this waits for it; the person
 * still sends the message, which is what records the reference.
 */
export async function insertReferenceInMapWindow(
  windowSelector: string,
  source: ConversationReferenceCreate
): Promise<boolean> {
  const deadline = Date.now() + WAIT_FOR_COMPOSER_MS
  while (Date.now() < deadline) {
    const root = document.querySelector(windowSelector)
    const composer = root ? conversationReferenceComposerWithin(root) : null
    if (composer?.input.current) {
      composer.input.current.focus()
      await addConversationReferenceToComposer(composer, source)
      return true
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  return false
}
