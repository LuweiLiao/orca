import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { AgentImageDisplayReceipt } from '../../shared/agent-image-display'
import { parseOrcaSessionAddress } from '../../shared/orca-session-address'
import { readInjectedAgentSessionId } from '../../shared/agent-session-caller-env'
import type { HandlerContext, CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

function sessionId(ctx: HandlerContext): string {
  if (ctx.client.isRemote && !ctx.flags.has('session')) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Remote image commands require --session <Orca session id> on the selected host.'
    )
  }
  const selected =
    getOptionalStringFlag(ctx.flags, 'session') ?? readInjectedAgentSessionId(process.env)
  if (!selected) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Run inside an Orca chat or supply --session <Orca session id>.'
    )
  }
  return parseOrcaSessionAddress(selected) ?? selected
}

const show: CommandHandler = async (ctx) => {
  const source = getRequiredStringFlag(ctx.flags, 'path')
  const path = ctx.client.isRemote ? source : resolve(ctx.cwd, source)
  const result = await ctx.client.call<AgentImageDisplayReceipt>('agentSession.showImage', {
    sessionId: sessionId(ctx),
    id: getOptionalStringFlag(ctx.flags, 'id') ?? randomUUID(),
    path,
    alt: getOptionalStringFlag(ctx.flags, 'title')
  })
  printResult(result, ctx.json, (value) => `${value.state}: ${value.path}\nImage id: ${value.id}`)
}

const status: CommandHandler = async (ctx) => {
  const result = await ctx.client.call<AgentImageDisplayReceipt>('agentSession.imageStatus', {
    sessionId: sessionId(ctx),
    id: getRequiredStringFlag(ctx.flags, 'id')
  })
  printResult(result, ctx.json, (value) => `${value.state}: ${value.path}`)
}

export const IMAGE_HANDLERS: Record<string, CommandHandler> = {
  'image show': show,
  'image status': status
}
