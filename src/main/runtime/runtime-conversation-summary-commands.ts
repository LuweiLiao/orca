import type { ConversationSummaryGenerateResult } from '../../shared/conversation-summary'
import {
  cancelConversationSummaryRequest,
  generateConversationHandoffSummaryRequest,
  generateConversationSummaryRequest,
  type ConversationHandoffSummaryResult,
  type ConversationSummaryChat,
  type ConversationSummaryHost
} from '../text-generation/conversation-summary-requests'

export class RuntimeConversationSummaryCommands {
  constructor(private readonly host: ConversationSummaryHost) {}

  conversationSummaryGenerate(
    chat: ConversationSummaryChat,
    requestId: string,
    owner: string,
    signal?: AbortSignal
  ): Promise<ConversationSummaryGenerateResult> {
    return generateConversationSummaryRequest(this.host, owner, chat, requestId, signal)
  }

  /** A hand-off child's starting summary of one or several chats; see the request for why unsaved. */
  conversationSummaryForHandoff(
    input: Parameters<typeof generateConversationHandoffSummaryRequest>[1],
    signal?: AbortSignal
  ): Promise<ConversationHandoffSummaryResult> {
    return generateConversationHandoffSummaryRequest(this.host, input, signal)
  }

  conversationSummaryCancel(
    args: { sessionId: string; requestId: string },
    owner: string
  ): { ok: true } {
    cancelConversationSummaryRequest(owner, args)
    return { ok: true }
  }
}
