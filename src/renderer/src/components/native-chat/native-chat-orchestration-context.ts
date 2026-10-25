import { createContext } from 'react'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

export type NativeChatOrchestrationContextValue = {
  terminalTabId: string
  structuredTransport?: NativeChatStructuredComposerTransport
}

export const NativeChatOrchestrationContext =
  createContext<NativeChatOrchestrationContextValue | null>(null)
