import type { HandlerGroup } from '../dispatch/handler-group-manifest'

export const CONVERSATION_HANDLER_GROUP: HandlerGroup = {
  name: 'conversation',
  keys: ['conversation read', 'conversation search'],
  load: async () => (await import('./conversation.js')).CONVERSATION_HANDLERS
}
