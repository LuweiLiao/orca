import type { HandlerGroup } from './handler-group-manifest'

export const IMAGE_HANDLER_GROUP: HandlerGroup = {
  name: 'image',
  keys: ['image show', 'image status'],
  load: async () => (await import('./handlers/image.js')).IMAGE_HANDLERS
}
