import { defineMethod } from '../core'
import {
  ImageDisplayTarget,
  ShowImageParams,
  ReportImageDisplayParams
} from '../../../../shared/rpc-contract/agent-image-display-params'
import { requireInstalledStructuredHost } from './structured-agent-session-gate'

export const STRUCTURED_AGENT_SESSION_IMAGE_METHODS = [
  defineMethod({
    name: 'agentSession.showImage',
    permission: 'workspace',
    params: ShowImageParams,
    handler: async (params, ctx) =>
      (await requireInstalledStructuredHost(ctx, params.sessionId)).images.show(params)
  }),
  defineMethod({
    name: 'agentSession.imageStatus',
    permission: 'workspace',
    params: ImageDisplayTarget,
    handler: async (params, ctx) =>
      (await requireInstalledStructuredHost(ctx, params.sessionId)).images.status(
        params.sessionId,
        params.id
      )
  }),
  defineMethod({
    name: 'agentSession.imageRendered',
    permission: 'workspace',
    params: ReportImageDisplayParams,
    handler: async (params, ctx) =>
      (await requireInstalledStructuredHost(ctx, params.sessionId)).images.report(params)
  })
]
