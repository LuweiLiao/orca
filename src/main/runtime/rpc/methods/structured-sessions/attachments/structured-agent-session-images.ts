import { defineMethod } from '../../../core'
import {
  ImageDisplayTarget,
  ShowImageParams,
  ReportImageDisplayParams
} from '../../../../../../shared/rpc-contract/structured-agent-session/agent-image-display-params'
import { requireInstalledStructuredHost } from '../creation/structured-agent-session-gate'
import { hostImages } from '../../../../../native-chat/agent-session-wire/delivery/structured-agent-session-images'

export const STRUCTURED_AGENT_SESSION_IMAGE_METHODS = [
  defineMethod({
    name: 'agentSession.showImage',
    permission: 'workspace',
    params: ShowImageParams,
    handler: async (params, ctx) =>
      hostImages(await requireInstalledStructuredHost(ctx, params.sessionId)).show(params)
  }),
  defineMethod({
    name: 'agentSession.imageStatus',
    permission: 'workspace',
    params: ImageDisplayTarget,
    handler: async (params, ctx) =>
      hostImages(await requireInstalledStructuredHost(ctx, params.sessionId)).status(
        params.sessionId,
        params.id
      )
  }),
  defineMethod({
    name: 'agentSession.imageRendered',
    permission: 'workspace',
    params: ReportImageDisplayParams,
    handler: async (params, ctx) =>
      hostImages(await requireInstalledStructuredHost(ctx, params.sessionId)).report(params)
  })
]
