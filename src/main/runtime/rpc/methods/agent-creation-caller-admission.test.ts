// Who may start an agent directly; no provider process is started.
import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_DELEGATION_UNAUTHORIZED_CODE,
  ORCA_CLI_RUNTIME_CLIENT_CAPABILITY
} from '../../../../shared/agent-delegation-grant'
import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/agent-launch-runtime-capability'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../../../shared/electron-remote-runtime-client-capabilities'
import { DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES } from '../../../ipc/desktop-renderer-runtime-capabilities'
import { eraseRpcMethods, type RpcContext } from '../core'
import { DESKTOP_RPC_CALLER } from '../rpc-caller-identity'
import { CAPABLE_CLIENT, methodNamed, rpcContext, runtimeStub } from './agent-launch.test-fixture'

const createStructuredSession = vi.fn(async (_args: Record<string, unknown>) => ({
  ok: true as const,
  value: { sessionId: 'sess-1' }
}))

vi.mock('./structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: (args: Record<string, unknown>) =>
    createStructuredSession(args)
}))

const { AGENT_LAUNCH_METHODS } = await import('./agent-launch')
const { WORKTREE_METHODS } = await import('./worktree')
const { TERMINAL_METHODS } = await import('./terminal')
const { SESSION_TAB_METHODS } = await import('./session-tabs')
const { CONNECTOR_METHODS } = await import('./connector')
const AGENT_LAUNCH = methodNamed(AGENT_LAUNCH_METHODS, 'agent.launch')

const PAIRED_CLI: Partial<RpcContext> = {
  pairedDeviceId: 'device-cli',
  clientKind: 'runtime',
  clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY, ORCA_CLI_RUNTIME_CLIENT_CAPABILITY]
}
const AGENT_CALLERS: { name: string; context: Partial<RpcContext> }[] = [
  { name: 'the local CLI socket', context: {} },
  { name: 'the paired orca CLI', context: PAIRED_CLI },
  {
    name: 'the orca CLI paired through a phone’s offer',
    context: { ...PAIRED_CLI, clientKind: 'mobile' }
  },
  {
    name: 'a paired CLI from before the CLI marker',
    context: { ...PAIRED_CLI, clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY] }
  }
]
const PERSON_CALLERS: { name: string; context: Partial<RpcContext> }[] = [
  {
    name: 'this host’s window',
    context: {
      caller: DESKTOP_RPC_CALLER,
      clientKind: 'runtime',
      clientCapabilities: DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES
    }
  },
  { name: 'a paired phone', context: CAPABLE_CLIENT },
  {
    name: 'a paired desktop app',
    context: {
      pairedDeviceId: 'device-desktop',
      clientKind: 'runtime',
      clientCapabilities: ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
    }
  }
]

function launchParams() {
  const parsed = AGENT_LAUNCH.params.safeParse({
    agent: 'claude',
    target: { kind: 'existing', worktree: 'id:wt-7' }
  })
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'invalid')
  }
  return parsed.data
}

const REFUSED = {
  code: AGENT_DELEGATION_UNAUTHORIZED_CODE,
  data: expect.objectContaining({ effectsApplied: false })
}

describe('agent.launch starts agents only for a person’s app', () => {
  it.each(AGENT_CALLERS)('refuses $name before anything is created', async ({ context }) => {
    createStructuredSession.mockClear()
    const runtime = runtimeStub()
    await expect(
      Promise.resolve().then(() =>
        AGENT_LAUNCH.handler(launchParams(), rpcContext(runtime, context))
      )
    ).rejects.toMatchObject(REFUSED)
    expect(createStructuredSession).not.toHaveBeenCalled()
    expect(runtime.createTerminal).not.toHaveBeenCalled()
  })

  it.each(PERSON_CALLERS)('starts the agent for $name', async ({ context }) => {
    createStructuredSession.mockClear()
    const result = await AGENT_LAUNCH.handler(launchParams(), rpcContext(runtimeStub(), context))
    expect(result.outcome).toMatchObject({ kind: 'structured', sessionId: 'sess-1' })
    expect(createStructuredSession).toHaveBeenCalledOnce()
  })
})

describe('the older creation entries refuse an agent’s client too', () => {
  const startConversation = vi.fn()
  const runtime = {
    dedupeWorktreeCreate: vi.fn(),
    dedupeTerminalCreate: vi.fn(),
    createMobileSessionTerminal: vi.fn(),
    handleAgentTeamsTmuxCompat: vi.fn(),
    prepareClaudeAgentTeamsLeader: vi.fn(),
    getExternalConversationSeam: () => ({ start: startConversation })
  }
  const entries = [
    {
      name: 'worktree.create',
      methods: WORKTREE_METHODS,
      params: { repo: 'id:repo-1', name: 'feature', startupAgent: 'claude' },
      effect: runtime.dedupeWorktreeCreate
    },
    {
      name: 'terminal.create',
      methods: TERMINAL_METHODS,
      params: { worktree: 'id:wt-7', command: 'claude', launchAgent: 'claude' },
      effect: runtime.dedupeTerminalCreate
    },
    {
      name: 'session.tabs.createTerminal',
      methods: SESSION_TAB_METHODS,
      params: { worktree: 'id:wt-7', agent: 'claude' },
      effect: runtime.createMobileSessionTerminal
    },
    {
      name: 'agentTeams.tmuxCompat',
      methods: TERMINAL_METHODS,
      params: { teamId: 'team-1', token: 'token', envPane: '%0', argv: ['split-window', 'claude'] },
      effect: runtime.handleAgentTeamsTmuxCompat
    },
    {
      name: 'agentTeams.prepareLaunch',
      methods: TERMINAL_METHODS,
      params: { paneKey: 'pane-1' },
      effect: runtime.prepareClaudeAgentTeamsLeader
    },
    {
      name: 'connector.start',
      methods: CONNECTOR_METHODS,
      params: {
        source: 'slack',
        externalId: 'thread-1',
        deliveryId: 'delivery-1',
        agent: 'claude',
        target: { kind: 'existing', worktree: 'id:wt-7' },
        prompt: 'Help with this thread'
      },
      effect: startConversation
    }
  ]

  it.each(entries.flatMap((entry) => AGENT_CALLERS.map((caller) => ({ entry, caller }))))(
    '$entry.name refuses $caller.name before starting an agent',
    async ({ entry, caller }) => {
      const method = eraseRpcMethods(entry.methods).find(
        (candidate) => candidate.name === entry.name
      )!
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these entries reach only the runtime members stubbed above before refusing.
      const context = { runtime, ...caller.context } as unknown as RpcContext
      await expect(
        Promise.resolve().then(() =>
          method.handler(method.params!.parse(entry.params), context, () => {})
        )
      ).rejects.toMatchObject(REFUSED)
      expect(entry.effect).not.toHaveBeenCalled()
    }
  )

  it.each(
    entries.filter(
      (entry) => entry.name === 'connector.start' || entry.name.startsWith('agentTeams.')
    )
  )("$name remains available to the person's app", async (entry) => {
    entry.effect.mockClear()
    const method = eraseRpcMethods(entry.methods).find(
      (candidate) => candidate.name === entry.name
    )!
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler calls only these stubbed runtime services.
    const context = { runtime, caller: DESKTOP_RPC_CALLER } as unknown as RpcContext
    await method.handler(method.params!.parse(entry.params), context, () => {})
    expect(entry.effect).toHaveBeenCalledOnce()
  })
})
