import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  clampConversationNameFirstPrompt,
  conversationNameSeed
} from '../../shared/conversation-name-generation'
import { hasStructuredChatPromptText } from '../../shared/structured-agent-session-first-prompt'
import type { StructuredChatNamingDeps } from './structured-chat-naming'

export function createStructuredChatNameRecovery({
  deps,
  jobs,
  stopped,
  recoverRecord,
  warn
}: {
  deps: StructuredChatNamingDeps
  jobs: ReadonlyMap<string, Promise<void>>
  stopped: () => boolean
  recoverRecord: (
    record: AgentSessionRecord,
    prompt: string,
    stillCurrent: () => boolean
  ) => Promise<void>
  warn: (sessionId: string, error: unknown) => void
}): () => Promise<void> {
  let recovery: Promise<void> = Promise.resolve()
  return () => {
    recovery = recovery
      .then(async () => {
        const store = deps.getStore()
        if (stopped() || !store) {
          return
        }
        for (const record of deps.listRecords?.() ?? []) {
          if (stopped() || deps.getSettings().nativeChatAutoName === false) {
            return
          }
          if (
            !record.conversationName ||
            record.conversationNameSource === 'generated' ||
            record.conversationNameSource === 'manual' ||
            deps.workerTaskTitle(record) ||
            deps.canRecover?.(record) === false
          ) {
            continue
          }
          try {
            await jobs.get(record.sessionId)
            const stillCurrent = () =>
              !stopped() &&
              deps.getSettings().nativeChatAutoName !== false &&
              deps.canRecover?.(record) !== false &&
              store.getRecord(record.sessionId)?.conversationName === record.conversationName &&
              store.getRecord(record.sessionId)?.conversationNameSource ===
                record.conversationNameSource
            if (!stillCurrent()) {
              continue
            }
            const prompt = clampConversationNameFirstPrompt(
              await deps.readJournalFirstPrompt(record.sessionId)
            )
            if (
              hasStructuredChatPromptText(prompt) &&
              conversationNameSeed(prompt) === record.conversationName &&
              stillCurrent()
            ) {
              await recoverRecord(record, prompt, stillCurrent)
            }
          } catch (error) {
            warn(record.sessionId, error)
          }
        }
      })
      .catch((error: unknown) => warn('recovery', error))
    return recovery
  }
}
