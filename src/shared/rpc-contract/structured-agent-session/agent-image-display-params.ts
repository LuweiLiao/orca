import { z } from 'zod'
import { SessionId } from './structured-agent-session-identifiers'

const DisplayId = z.string().min(1).max(128)
export const ImageDisplayTarget = z.object({ sessionId: SessionId, id: DisplayId }).strict()
export const ShowImageParams = ImageDisplayTarget.extend({
  path: z.string().min(1).max(8192),
  alt: z.string().max(512).optional()
}).strict()
export const ReportImageDisplayParams = ImageDisplayTarget.extend({
  state: z.enum(['loaded', 'failed'])
}).strict()
