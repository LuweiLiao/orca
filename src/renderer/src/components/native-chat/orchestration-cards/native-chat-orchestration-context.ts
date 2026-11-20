import { createContext } from 'react'
import type { NativeChatStructuredComposerTransport } from '../composer/submit/native-chat-structured-composer-transport'

export type NativeChatOrchestrationContextValue = {
  terminalTabId: string
  structuredTransport?: NativeChatStructuredComposerTransport
}

export const NativeChatOrchestrationContext =
  createContext<NativeChatOrchestrationContextValue | null>(null)
