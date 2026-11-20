// Do not gate queued-card actions on queued-messages.v2: hosts without it still publish unsent cards. Older pre-queue/edit hosts lack the methods.

import { defineMethod } from '../../../core'
import {
  requireStructuredSessionHost as requireSessionHost,
  requireStructuredCleanupHost,
  structuredCallerFor as callerFor
} from '../creation/structured-agent-session-gate'
import {
  QueuedMessageActionParams,
  QueuedMessagesResumeParams
} from '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-params'
import '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-continue-params'
import '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-rename-params'
import {
  QueuedMessageMoveParams,
  QueuedMessageUpdateParams,
  QueuedMessageEditHoldParams
} from '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-queued-edit-params'
import { typedByOf } from '../../../callers/rpc-caller-typed-by'
import { readsQueuedImageCards } from '../attachments/structured-agent-session-queued-image-capability'
import { revokeQueuedMessageAgentDelegation } from '../../agent-delegation-grant-recording'

export const STRUCTURED_AGENT_SESSION_QUEUED_METHODS = [
  defineMethod({
    name: 'agentSession.queuedMessageUpdate',
    permission: 'workspace',
    params: QueuedMessageUpdateParams,
    handler: async ({ orchestrationCards, ...params }, ctx) => {
      // A changed card is the editor's words now: it posts as whoever typed the edit.
      const typedBy = typedByOf(ctx)
      const result = await requireSessionHost(ctx, params.envelope.sessionId).queuedMessageUpdate(
        callerFor(ctx),
        {
          ...params,
          ...(typedBy ? { typedBy } : {}),
          queuedImageCards: readsQueuedImageCards(ctx)
        }
      )
      // A replay changed nothing now; a later edit may already have replaced what it recorded.
      if (result.ok && !result.replayed) {
        revokeQueuedMessageAgentDelegation(ctx, {
          sessionId: params.envelope.sessionId,
          messageId: params.messageId,
          operationId: params.envelope.clientOperationId,
          edited: { text: params.text, cards: orchestrationCards }
        })
      }
      return result
    }
  }),
  defineMethod({
    name: 'agentSession.queuedMessageEditHold',
    permission: 'workspace',
    params: QueuedMessageEditHoldParams,
    handler: async (params, ctx) => {
      // Releasing a lease is cleanup: no admission condition may strand it until its deadline.
      const host =
        params.action === 'release'
          ? requireStructuredCleanupHost(ctx)
          : requireSessionHost(ctx, params.sessionId)
      return host.queuedMessageEditHold(callerFor(ctx), params)
    }
  }),
  defineMethod({
    name: 'agentSession.queuedMessageSend',
    permission: 'workspace',
    params: QueuedMessageActionParams,
    handler: async (params, ctx) =>
      requireSessionHost(ctx, params.envelope.sessionId).queuedMessageSend(callerFor(ctx), params)
  }),
  defineMethod({
    name: 'agentSession.queuedMessageDelete',
    permission: 'workspace',
    params: QueuedMessageActionParams,
    handler: async (params, ctx) => {
      const result = await requireSessionHost(ctx, params.envelope.sessionId).queuedMessageDelete(
        callerFor(ctx),
        params
      )
      if (result.ok && !result.replayed && result.value.deleted) {
        revokeQueuedMessageAgentDelegation(ctx, {
          sessionId: params.envelope.sessionId,
          messageId: params.messageId,
          operationId: params.envelope.clientOperationId
        })
      }
      return result
    }
  }),
  defineMethod({
    name: 'agentSession.queuedMessageMove',
    permission: 'workspace',
    params: QueuedMessageMoveParams,
    handler: async (params, ctx) =>
      requireSessionHost(ctx, params.envelope.sessionId).queuedMessageMove(callerFor(ctx), params)
  }),
  defineMethod({
    name: 'agentSession.queuedMessagesResume',
    permission: 'workspace',
    params: QueuedMessagesResumeParams,
    handler: async (params, ctx) =>
      requireSessionHost(ctx, params.envelope.sessionId).queuedMessagesResume(
        callerFor(ctx),
        params
      )
  })
]
