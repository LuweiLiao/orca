// `agentSession.references`: the conversations sent messages referenced, for the project map.

import { ReferencesParams } from '../../../../../../shared/agent-session/agent-session-reference-link'
import { listConversationReferenceLinks } from '../../../../../ai-vault/conversation-reference-link-store'
import { agentSessionReferenceView } from '../../../../../native-chat/agent-session-reference-links'
import { defineMethod } from '../../../core'
import { requireInstalledStructuredHost } from '../creation/structured-agent-session-gate'

export const STRUCTURED_AGENT_SESSION_REFERENCES_METHODS = [
  defineMethod({
    name: 'agentSession.references',
    permission: 'workspace',
    params: ReferencesParams,
    handler: async (params, ctx) => {
      const host = await requireInstalledStructuredHost(ctx)
      return agentSessionReferenceView(
        await listConversationReferenceLinks(),
        (sessionId) => host.deps.store.getRecord(sessionId),
        params.sessionIds
      )
    }
  })
]
