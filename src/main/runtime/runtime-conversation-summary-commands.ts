import type { ConversationSummaryGenerateResult } from '../../shared/conversation-summary'
import {
  cancelConversationSummaryRequest,
  generateConversationSummaryRequest,
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

  conversationSummaryCancel(
    args: { sessionId: string; requestId: string },
    owner: string
  ): { ok: true } {
    cancelConversationSummaryRequest(owner, args)
    return { ok: true }
  }
}
