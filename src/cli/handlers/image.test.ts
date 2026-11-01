import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { IMAGE_HANDLERS } from './image'
import { parseArgs, normalizeCommandPositionals, specPaths } from '../args'
import { IMAGE_COMMAND_SPECS } from '../specs/image'
import {
  ImageDisplayTarget,
  ShowImageParams
} from '../../shared/rpc-contract/agent-image-display-params'
import type { RuntimeClient } from '../runtime-client'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const parse = (args: string[]) =>
  normalizeCommandPositionals(
    IMAGE_COMMAND_SPECS,
    parseArgs(args, IMAGE_COMMAND_SPECS.flatMap(specPaths), IMAGE_COMMAND_SPECS)
  )

it('parses image commands and sends the active conversation and cwd-qualified path through RPC', async () => {
  vi.stubEnv('ORCA_AGENT_SESSION_ID', 'claude_here')
  const request = vi.fn(async (_method: string, params: unknown) => {
    const parsed = ShowImageParams.parse(params)
    return { ok: true, result: { ...parsed, state: 'pending', itemId: 'image-item' } }
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const parsed = parse([
    'image',
    'show',
    'figs/result.png',
    '--title',
    'Plot',
    '--id',
    'plot-1',
    '--json'
  ])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only call and isRemote; this fixture validates the real RPC params.
  const client = { isRemote: false, call: request } as unknown as RuntimeClient
  await IMAGE_HANDLERS[parsed.commandPath.join(' ')]({
    flags: parsed.flags,
    client,
    cwd: '/project',
    json: true
  })
  expect(request).toHaveBeenCalledWith('agentSession.showImage', {
    sessionId: 'claude_here',
    id: 'plot-1',
    path: resolve('/project', 'figs/result.png'),
    alt: 'Plot'
  })
})

it('allows an explicit remote conversation without resolving a server path against this client', async () => {
  const request = vi.fn(async (_method: string, params: unknown) => ({
    ok: true,
    result: { ...ShowImageParams.parse(params), state: 'pending' }
  }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these are the only RuntimeClient members called by the handler.
  const client = { isRemote: true, call: request } as unknown as RuntimeClient
  const parsed = parse([
    'image',
    'show',
    '/home/ubuntu/plot.png',
    '--session',
    'claude_remote',
    '--json'
  ])
  await IMAGE_HANDLERS['image show']({ flags: parsed.flags, client, cwd: '/local', json: true })
  expect(request).toHaveBeenCalledWith(
    'agentSession.showImage',
    expect.objectContaining({ sessionId: 'claude_remote', path: '/home/ubuntu/plot.png' })
  )
})

it('reads a receipt and fails before RPC when no conversation was specified', async () => {
  vi.stubEnv('ORCA_AGENT_SESSION_ID', '')
  const request = vi.fn(async (_method: string, params: unknown) => ({
    ok: true,
    result: { ...ImageDisplayTarget.parse(params), state: 'loaded', path: '/plot.png' }
  }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the status handler uses only call and the show handler uses isRemote.
  const client = { isRemote: false, call: request } as unknown as RuntimeClient
  const noSession = parse(['image', 'show', 'plot.png'])
  await expect(
    IMAGE_HANDLERS['image show']({ flags: noSession.flags, client, cwd: '/project', json: true })
  ).rejects.toThrow('supply --session')
  expect(request).not.toHaveBeenCalled()
  const parsed = parse([
    'image',
    'status',
    'plot-1',
    '--session',
    'orca_session_id:claude_remote',
    '--json'
  ])
  await IMAGE_HANDLERS['image status']({ flags: parsed.flags, client, cwd: '/project', json: true })
  expect(request).toHaveBeenCalledWith('agentSession.imageStatus', {
    sessionId: 'claude_remote',
    id: 'plot-1'
  })
})
