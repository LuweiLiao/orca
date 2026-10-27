import { defineMethod } from '../core'
import {
  ConversationReferenceCreateParams,
  ConversationReferenceReadParams,
  ConversationReferenceRetargetParams
} from '../../../../shared/conversation-reference'
import {
  createLocalConversationReference,
  readLocalConversationReference,
  retargetLocalConversationReference
} from '../../../ai-vault/conversation-reference-reader'
import { getRuntimeDesktopSurface } from '../../runtime-desktop-surface'

export const CONVERSATION_METHODS = [
  defineMethod({
    name: 'conversation.retargetReference',
    permission: 'workspace',
    params: ConversationReferenceRetargetParams,
    handler: async (params, { runtime }) => {
      const reference = await retargetLocalConversationReference(params, () =>
        runtime.ensureStructuredAgentSessionHost()
      )
      if (!reference) {
        throw new Error('The referenced conversation is not stored on this host.')
      }
      return reference
    }
  }),
  defineMethod({
    name: 'conversation.createReference',
    permission: 'workspace',
    params: ConversationReferenceCreateParams,
    handler: async (params, { runtime, signal }) => {
      if (params.source.kind === 'structured') {
        await runtime.ensureStructuredAgentSessionHost()
      }
      return createLocalConversationReference(params, () =>
        runtime.listAiVaultSessions({ unlimited: true }, signal)
      )
    }
  }),
  defineMethod({
    name: 'conversation.read',
    permission: 'workspace',
    params: ConversationReferenceReadParams,
    handler: async (params, { runtime, signal }) => {
      const page = await readLocalConversationReference(params, signal, () =>
        runtime.ensureStructuredAgentSessionHost()
      )
      if (page) {
        return page
      }
      if (params.localOnly) {
        throw new Error('The referenced conversation is unavailable on its source host.')
      }
      const forward = getRuntimeDesktopSurface().forwardConversationReference
      if (!forward) {
        throw new Error('The referenced conversation is not available on this host.')
      }
      return forward('conversation.read', params)
    }
  })
]
