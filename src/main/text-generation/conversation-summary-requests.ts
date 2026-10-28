import { LOCAL_COMMIT_MESSAGE_HOST_KEY } from '../../shared/commit-message-host-key'
import {
  conversationSummaryStale,
  type ConversationSummaryGenerateResult,
  type ConversationSummaryState
} from '../../shared/conversation-summary'
import type { ConversationSummaryMessage } from '../../shared/conversation-summary-prompt'
import {
  loadConversationSummary,
  saveConversationSummary
} from '../ai-vault/conversation-summary-store'
import {
  prepareLocalCommitMessageAgentEnv,
  type CommitMessageAgentEnvironmentResolvers
} from './commit-message-agent-environment'
import { resolveTextGenerationParams } from './commit-message-text-generation'
import {
  cancelConversationSummaryLocal,
  generateConversationSummary
} from './conversation-summary-text-generation'

export type ConversationSummaryHost = {
  getSettings: () => Parameters<typeof resolveTextGenerationParams>[0]
  getAgentEnvironment: () => CommitMessageAgentEnvironmentResolvers | undefined
}

export type ConversationSummaryChat = {
  sessionId: string
  cwd: string
  messages: readonly (ConversationSummaryMessage & { id: string })[]
}

type ActiveRequest = { owner: string; sessionId: string; requestId: string; cwd: string }
// One summary runs at a time: each is a billed model call the person asked for by hand.
let activeRequest: ActiveRequest | undefined

export async function conversationSummaryState(
  sessionId: string,
  messageIds: readonly string[]
): Promise<ConversationSummaryState> {
  const summary = await loadConversationSummary(sessionId)
  return { summary, stale: conversationSummaryStale(summary, messageIds) }
}

export function cancelConversationSummaryRequest(
  owner: string,
  args: { sessionId: string; requestId: string }
): void {
  if (
    activeRequest?.owner === owner &&
    activeRequest.sessionId === args.sessionId &&
    activeRequest.requestId === args.requestId
  ) {
    const { cwd } = activeRequest
    activeRequest = undefined
    cancelConversationSummaryLocal(cwd)
  }
}

export async function generateConversationSummaryRequest(
  host: ConversationSummaryHost,
  owner: string,
  chat: ConversationSummaryChat,
  requestId: string,
  signal?: AbortSignal
): Promise<ConversationSummaryGenerateResult> {
  const last = chat.messages.at(-1)
  if (!last) {
    return { success: false, error: 'This chat has no messages to summarize yet.' }
  }
  if (signal?.aborted) {
    return { success: false, error: 'Generation canceled.', canceled: true }
  }
  if (activeRequest) {
    return { success: false, error: 'A chat summary is already being generated.' }
  }
  const request: ActiveRequest = { owner, sessionId: chat.sessionId, requestId, cwd: chat.cwd }
  activeRequest = request
  const cancel = (): void => cancelConversationSummaryRequest(owner, request)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const resolved = resolveTextGenerationParams(
      host.getSettings(),
      LOCAL_COMMIT_MESSAGE_HOST_KEY,
      'conversationName',
      null
    )
    if (!resolved.ok) {
      return { success: false, error: resolved.error }
    }
    const localEnv = await prepareLocalCommitMessageAgentEnv(
      resolved.params.agentId,
      host.getAgentEnvironment()
    )
    if (activeRequest !== request) {
      return { success: false, error: 'Generation canceled.', canceled: true }
    }
    if (!localEnv.ok) {
      return { success: false, error: localEnv.error }
    }
    const result = await generateConversationSummary({
      messages: chat.messages,
      params: resolved.params,
      target: { kind: 'local', cwd: chat.cwd, ...(localEnv.env ? { env: localEnv.env } : {}) }
    })
    if (activeRequest !== request) {
      return { success: false, error: 'Generation canceled.', canceled: true }
    }
    if (!result.success) {
      return result
    }
    await saveConversationSummary(chat.sessionId, {
      text: result.text,
      throughMessageCount: chat.messages.length,
      throughMessageId: last.id,
      generatedAt: Date.now(),
      edited: false,
      ...(result.agentLabel ? { agentLabel: result.agentLabel } : {})
    })
    return {
      success: true,
      state: await conversationSummaryState(
        chat.sessionId,
        chat.messages.map((message) => message.id)
      )
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    if (activeRequest === request) {
      activeRequest = undefined
    }
  }
}
