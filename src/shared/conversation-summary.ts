import { z } from 'zod'

// Why: the summary RPCs are new, so an older host answers method_not_found; offer them only here.
export const CONVERSATION_SUMMARY_CAPABILITY = 'conversation.summary.v1' as const

export const CONVERSATION_SUMMARY_MAX_CHARS = 20_000

const SessionId = z.string().min(1).max(512)

export const ConversationSummaryReadParams = z.object({ sessionId: SessionId }).strict()
export const ConversationSummaryListParams = z
  .object({ sessionIds: z.array(SessionId).max(2048) })
  .strict()
export const ConversationSummaryWriteParams = z
  .object({
    sessionId: SessionId,
    text: z.string().trim().min(1).max(CONVERSATION_SUMMARY_MAX_CHARS)
  })
  .strict()
export const ConversationSummaryGenerateParams = z
  .object({ sessionId: SessionId, requestId: z.string().min(1).max(128) })
  .strict()
export const ConversationSummaryCancelParams = ConversationSummaryGenerateParams

export type ConversationSummaryRecord = {
  text: string
  /** How many messages the summary covered, and the last one it saw. */
  throughMessageCount: number
  throughMessageId: string
  generatedAt: number
  /** The person changed the text after it was generated. */
  edited: boolean
  agentLabel?: string
}

export type ConversationSummaryState = {
  summary: ConversationSummaryRecord | null
  /** The chat has messages the summary did not see, or lost the ones it did (a rewind). */
  stale: boolean
}

export type ConversationSummaryGenerateResult =
  | { success: true; state: ConversationSummaryState }
  | { success: false; error: string; canceled?: boolean }

export function conversationSummaryStale(
  summary: Pick<ConversationSummaryRecord, 'throughMessageCount' | 'throughMessageId'> | null,
  messageIds: readonly string[]
): boolean {
  if (!summary) {
    return false
  }
  return (
    messageIds.length !== summary.throughMessageCount ||
    messageIds[summary.throughMessageCount - 1] !== summary.throughMessageId
  )
}
