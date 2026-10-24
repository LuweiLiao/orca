import { defineMethod } from '../core'
import {
  ConversationReferenceCreateParams,
  ConversationReferenceReadParams
} from '../../../../shared/conversation-reference'
import {
  createLocalConversationReference,
  readLocalConversationReference
} from '../../../ai-vault/conversation-reference-reader'
import { forwardConversationReference } from '../../../ai-vault/conversation-reference-routing'

export const CONVERSATION_METHODS = [
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
      return forwardConversationReference('conversation.read', params)
    }
  })
]
