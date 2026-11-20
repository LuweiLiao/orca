import type { HandlerGroup } from '../dispatch/handler-group-manifest'

export const IMAGE_HANDLER_GROUP: HandlerGroup = {
  name: 'image',
  keys: ['image show', 'image status'],
  load: async () => (await import('./image.js')).IMAGE_HANDLERS
}
