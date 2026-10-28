// `agentSession.summary*` — a hand-made summary of one chat, kept beside it and never in its log.
//
// Additive and negotiated: a client calls these only once the host advertises
// `conversation.summary.v1`. Generating is a billed model call, so only an explicit request runs it.

import {
  conversationSummaryStale,
  ConversationSummaryCancelParams,
  ConversationSummaryGenerateParams,
  ConversationSummaryListParams,
  ConversationSummaryReadParams,
  ConversationSummaryWriteParams,
  type ConversationSummaryState
} from '../../../../shared/conversation-summary'
import { journalConversationMessages } from '../../../ai-vault/conversation-reference-reader'
import {
  conversationSummarySessions,
  loadConversationSummary,
  saveConversationSummary
} from '../../../ai-vault/conversation-summary-store'
import { conversationSummaryState } from '../../../text-generation/conversation-summary-requests'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { defineMethod, type RpcContext } from '../core'
import { requireInstalledStructuredHost } from './structured-agent-session-gate'

async function chatMessages(ctx: RpcContext, sessionId: string) {
  const host = await requireInstalledStructuredHost(ctx, sessionId)
  const record = host.deps.store.getRecord(sessionId)
  if (!record) {
    throw new Error('The chat is unavailable.')
  }
  const snapshot = await host.journalSnapshot(sessionId)
  return { record, messages: [...journalConversationMessages(snapshot)] }
}

function summaryOwner(ctx: Pick<RpcContext, 'pairedDeviceId' | 'caller'>): string {
  if (ctx.pairedDeviceId) {
    return `device:${ctx.pairedDeviceId}`
  }
  if (ctx.caller?.kind === 'paired-device') {
    return `device:${ctx.caller.deviceId}`
  }
  return ctx.caller?.kind === 'local-cli' ? 'local-cli' : 'desktop'
}

export const STRUCTURED_AGENT_SESSION_SUMMARY_METHODS = [
  defineMethod({
    name: 'agentSession.summaryList',
    permission: 'workspace',
    params: ConversationSummaryListParams,
    handler: async (params, ctx) => {
      await requireInstalledStructuredHost(ctx)
      return { sessionIds: await conversationSummarySessions(params.sessionIds) }
    }
  }),
  defineMethod({
    name: 'agentSession.summaryRead',
    permission: 'workspace',
    params: ConversationSummaryReadParams,
    handler: async (params, ctx): Promise<ConversationSummaryState> => {
      const { messages } = await chatMessages(ctx, params.sessionId)
      return conversationSummaryState(
        params.sessionId,
        messages.map((message) => message.id)
      )
    }
  }),
  defineMethod({
    name: 'agentSession.summaryWrite',
    permission: 'workspace',
    params: ConversationSummaryWriteParams,
    handler: async (params, ctx): Promise<ConversationSummaryState> => {
      const { messages } = await chatMessages(ctx, params.sessionId)
      const previous = await loadConversationSummary(params.sessionId)
      const last = messages.at(-1)
      // A first summary written by hand covers the chat as it stands; an edit keeps what it saw.
      await saveConversationSummary(params.sessionId, {
        throughMessageCount: previous?.throughMessageCount ?? messages.length,
        throughMessageId: previous?.throughMessageId ?? last?.id ?? '',
        generatedAt: previous?.generatedAt ?? Date.now(),
        ...(previous?.agentLabel ? { agentLabel: previous.agentLabel } : {}),
        text: params.text,
        edited: true
      })
      const summary = await loadConversationSummary(params.sessionId)
      const ids = messages.map((message) => message.id)
      return { summary, stale: conversationSummaryStale(summary, ids) }
    }
  }),
  defineMethod({
    name: 'agentSession.summaryGenerate',
    permission: 'workspace',
    params: ConversationSummaryGenerateParams,
    handler: async (params, ctx) => {
      const { record, messages } = await chatMessages(ctx, params.sessionId)
      if (record.location.wslDistro !== null) {
        return { success: false as const, error: 'This chat cannot be summarized in WSL.' }
      }
      const workspace = await ctx.runtime.resolveRuntimeFileTarget(
        `id:${record.location.workspaceId}`
      )
      if (workspace.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
        return { success: false as const, error: 'This chat is not stored on this host.' }
      }
      return ctx.runtime.conversationSummaryGenerate(
        {
          sessionId: params.sessionId,
          cwd: workspace.worktree.path,
          messages: messages.map(({ id, role, text }) => ({ id, role, text }))
        },
        params.requestId,
        summaryOwner(ctx),
        ctx.signal
      )
    }
  }),
  defineMethod({
    name: 'agentSession.summaryCancel',
    permission: 'workspace',
    params: ConversationSummaryCancelParams,
    handler: (params, ctx) => ctx.runtime.conversationSummaryCancel(params, summaryOwner(ctx))
  })
]
