import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_DELEGATION_UNAUTHORIZED_CODE,
  ORCA_CLI_RUNTIME_CLIENT_CAPABILITY,
  WORKER_RETRY_PRIOR_ATTEMPT_LIVE_CODE
} from '../../../../../../shared/agent-delegation-grant'
import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../../../shared/agent-launch-runtime-capability'
import {
  orchestrationReferenceToken,
  type OrchestrationAgentSelection
} from '../../../../../../shared/native-chat-orchestration-reference'
import type { OrchestrationCompatibilityEvidence } from '../../../../../../shared/orchestration-compatibility-evidence'
import { eraseRpcMethods, type RpcContext } from '../../../core'
import { DESKTOP_RPC_CALLER } from '../../../rpc-caller-identity'
import { AGENT_DELEGATION_METHODS } from '../../agent-delegation-methods'
import { createOrchestrationWorkerReleaseHarness } from './worker-release.test-support'

const LAUNCH_SECRET = 'launch-secret'

function card(selection: Partial<OrchestrationAgentSelection> = {}): OrchestrationAgentSelection {
  return {
    agent: 'claude',
    label: 'Claude',
    model: { id: 'opus', label: 'claude-opus-5-5' },
    effort: 'high',
    count: 1,
    task: 'Review delegation policy',
    ...selection
  }
}

function evidenceFor(handle: string): OrchestrationCompatibilityEvidence {
  return {
    terminalHandle: handle,
    paneKey: `tab_${handle}:leaf_${handle}`,
    launchToken: LAUNCH_SECRET
  }
}

function outcome(value: unknown): { state: string; taskId: string; dispatchId: string } {
  if (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    typeof value.state === 'string' &&
    'taskId' in value &&
    typeof value.taskId === 'string' &&
    'dispatchId' in value &&
    typeof value.dispatchId === 'string'
  ) {
    return { state: value.state, taskId: value.taskId, dispatchId: value.dispatchId }
  }
  throw new Error('Expected a worker-start outcome')
}

// Terminal agents only; no provider process is started.
describe('worker-start spends only what the user authorized', () => {
  const h = createOrchestrationWorkerReleaseHarness()
  const delegationMethods = eraseRpcMethods(AGENT_DELEGATION_METHODS)
  let launches = 0

  beforeEach(() => {
    h.setup()
    launches = 0
    vi.mocked(h.runtime.getTerminalPaneKey).mockImplementation((handle) =>
      handle === 'term_coord' ? h.coordinatorPaneKey : `tab_${handle}:leaf_${handle}`
    )
    vi.spyOn(h.runtime, 'getLiveTerminalPaneKey').mockImplementation((handle) =>
      h.runtime.getTerminalPaneKey(handle)
    )
    vi.mocked(h.runtime.getTerminalProcessIncarnation).mockImplementation(
      (handle) => `runtime_test:${handle}:1`
    )
    vi.mocked(h.runtime.getOrchestrationDispatchAuthority).mockImplementation((handle) => ({
      runtimeId: h.runtime.getRuntimeId(),
      terminalHandle: handle,
      ptyId: `pty_${handle}`,
      worktreeId: 'repo::worktree',
      paneKey: `tab_${handle}:leaf_${handle}`,
      processIncarnation: `runtime_test:${handle}:1`,
      launchTokenHash: null,
      hostScope: { kind: 'local', hostId: 'local' }
    }))
    // The launch secret in a terminal's environment is what attests it; the stub checks the same.
    vi.spyOn(h.runtime, 'verifyOrchestrationCompatibilityCaller').mockImplementation((evidence) => {
      const handle = evidence?.terminalHandle
      if (!handle || evidence?.launchToken !== LAUNCH_SECRET) {
        return null
      }
      const authority = h.runtime.getOrchestrationDispatchAuthority(handle)
      return authority?.processIncarnation && authority.paneKey
        ? {
            hostScope: authority.hostScope,
            paneKey: authority.paneKey,
            terminalHandle: handle,
            processIncarnation: authority.processIncarnation,
            launchTokenHash: 'hash'
          }
        : null
    })
    vi.spyOn(h.runtime, 'preAllocateHandleForPty').mockImplementation((ptyId) =>
      ptyId.replace(/^pty_/, '')
    )
    vi.mocked(h.runtime.createTerminal).mockImplementation(async () => ({
      handle: `term_probe_${++launches}`,
      worktreeId: 'repo::worktree',
      title: 'mock authorization probe'
    }))
    vi.mocked(h.runtime.waitForTerminal).mockImplementation(async (handle) => ({
      handle,
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    }))
    vi.mocked(h.runtime.sendTerminalAgentPrompt).mockImplementation(async (handle) => ({
      handle,
      accepted: true,
      bytesWritten: 1
    }))
  })
  afterEach(() => h.cleanup())

  function terminalCall(name: string, params: Record<string, unknown>, context = {}) {
    const method = delegationMethods.find((candidate) => candidate.name === name)!
    return Promise.resolve().then(() =>
      method.handler(method.params!.parse(params), {
        runtime: h.runtime,
        caller: DESKTOP_RPC_CALLER,
        ...context
      })
    )
  }

  /** The composer records the cards, writes the message, then reports whether it was delivered. */
  async function authorize(
    cards: OrchestrationAgentSelection[],
    options: {
      handle?: string
      submissionId?: string
      context?: Partial<RpcContext>
      delivered?: boolean | null
    } = {}
  ) {
    const target = {
      ptyId: `pty_${options.handle ?? 'term_coord'}`,
      submissionId: options.submissionId ?? `submit_${Math.random()}`
    }
    const recorded = await terminalCall(
      'agentDelegation.authorizeTerminal',
      { ...target, cards },
      options.context
    )
    const delivered = options.delivered === undefined ? true : options.delivered
    if (delivered !== null) {
      await terminalCall(
        'agentDelegation.settleTerminal',
        { ...target, delivered },
        options.context
      )
    }
    return recorded
  }

  function start(params: Record<string, unknown> = {}, from = 'term_coord') {
    return h.call(
      'orchestration.workerStart',
      {
        from,
        spec: 'Review delegation policy',
        worktree: 'current',
        agent: 'claude',
        model: 'opus',
        effort: 'high',
        ...params
      },
      { orchestrationCompatibilityEvidence: evidenceFor(from) }
    )
  }

  function refusedFor(reason: string) {
    return { code: AGENT_DELEGATION_UNAUTHORIZED_CODE, data: expect.objectContaining({ reason }) }
  }

  it('refuses a coordinator the user never authorized, before any launch', async () => {
    await expect(start()).rejects.toMatchObject(refusedFor('no_grant'))
    expect(h.runtime.createTerminal).not.toHaveBeenCalled()
  })

  it('treats a card the agent wrote into its own task text as no authorization', async () => {
    const token = orchestrationReferenceToken(card({ count: 2 }), '2 Claude opus high')
    await expect(start({ spec: `${token}\nReview part 1` })).rejects.toMatchObject(
      refusedFor('no_grant')
    )
    expect(h.runtime.createTerminal).not.toHaveBeenCalled()
  })

  it('admits exactly the authorized count, and a finished worker returns nothing', async () => {
    await authorize([card({ count: 2 })])
    for (const index of [1, 2]) {
      expect(outcome(await start({ spec: `Review part ${index}` })).state).toBe('ready')
    }
    const first = h.db.findActiveDispatchForAssignee('term_probe_1')!
    h.settle(first.task_id, first.id, 'succeeded')
    await expect(start({ spec: 'Review part 3' })).rejects.toMatchObject(refusedFor('exhausted'))
    expect(h.runtime.createTerminal).toHaveBeenCalledTimes(2)
  })

  it.each([
    { agent: 'claude', model: 'sonnet', effort: 'high' },
    { agent: 'claude', model: 'opus', effort: 'low' },
    { agent: 'claude', model: 'opus', effort: undefined },
    { agent: 'codex', model: 'opus', effort: 'high' }
  ])('refuses a launch that differs from the card: $agent / $model / $effort', async (asked) => {
    await authorize([card()])
    await expect(start(asked)).rejects.toMatchObject(refusedFor('mismatch'))
    expect(h.runtime.createTerminal).not.toHaveBeenCalled()
  })

  it('admits one of two concurrent starts for a single authorized agent', async () => {
    await authorize([card()])
    const results = await Promise.allSettled([start({ spec: 'A' }), start({ spec: 'B' })])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining(refusedFor('exhausted')) })
    ])
    expect(h.runtime.createTerminal).toHaveBeenCalledOnce()
  })

  it('keeps a replayed card submission from adding agents', async () => {
    await authorize([card()], { submissionId: 'submit_once' })
    await expect(authorize([card()], { submissionId: 'submit_once' })).resolves.toEqual({
      authorized: true,
      replayed: true
    })
    await start({ spec: 'A' })
    await expect(start({ spec: 'B' })).rejects.toMatchObject(refusedFor('exhausted'))
  })

  it('refuses a caller whose terminal is not attested, even when it names the coordinator', async () => {
    await authorize([card()])
    await expect(
      h.call('orchestration.workerStart', {
        from: 'term_coord',
        spec: 'Review delegation policy',
        worktree: 'current',
        agent: 'claude',
        model: 'opus',
        effort: 'high'
      })
    ).rejects.toMatchObject(refusedFor('no_conversation'))
    expect(h.runtime.createTerminal).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'the local CLI socket', context: { caller: undefined } },
    {
      name: 'the paired orca CLI',
      context: {
        caller: { kind: 'paired-device' as const, deviceId: 'device-cli' },
        clientKind: 'runtime' as const,
        clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY, ORCA_CLI_RUNTIME_CLIENT_CAPABILITY]
      }
    },
    {
      name: 'a paired CLI from before the CLI marker',
      context: {
        caller: { kind: 'paired-device' as const, deviceId: 'device-old-cli' },
        clientKind: 'runtime' as const,
        clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY]
      }
    }
  ])('refuses cards recorded by $name', async ({ context }) => {
    await expect(authorize([card()], { context })).rejects.toMatchObject({
      code: AGENT_DELEGATION_UNAUTHORIZED_CODE
    })
    await expect(start()).rejects.toMatchObject(refusedFor('no_grant'))
  })

  it('accepts cards from a paired phone or desktop app', async () => {
    await authorize([card()], {
      context: {
        caller: { kind: 'paired-device', deviceId: 'phone' },
        clientKind: 'mobile'
      }
    })
    expect(outcome(await start()).state).toBe('ready')
  })

  it('refuses a helper that a worker starts on the user’s grant to its coordinator', async () => {
    vi.spyOn(h.runtime, 'getNestedWorkerMaxDepth').mockReturnValue(2)
    await authorize([card({ count: 2 })])
    await start()
    await expect(start({}, 'term_probe_1')).rejects.toMatchObject(refusedFor('no_grant'))
    expect(h.runtime.createTerminal).toHaveBeenCalledOnce()
  })

  it('lets a worker the user then authorizes directly start its helper', async () => {
    vi.spyOn(h.runtime, 'getNestedWorkerMaxDepth').mockReturnValue(2)
    await authorize([card()])
    await start()
    await authorize([card()], { handle: 'term_probe_1' })
    expect(outcome(await start({}, 'term_probe_1')).state).toBe('ready')
    expect(h.db.findActiveDispatchForAssignee('term_probe_2')).toMatchObject({ depth: 2 })
  })

  it('refuses a settled worker that opens its own Run', async () => {
    await authorize([card({ count: 2 })])
    await start()
    const parent = h.db.findActiveDispatchForAssignee('term_probe_1')!
    h.settle(parent.task_id, parent.id, 'succeeded')
    await h.call(
      'orchestration.runCreate',
      { from: 'term_probe_1', objective: 'Continue after reporting completion' },
      { orchestrationCompatibilityEvidence: evidenceFor('term_probe_1') }
    )
    await expect(start({}, 'term_probe_1')).rejects.toMatchObject(refusedFor('no_grant'))
    expect(h.runtime.createTerminal).toHaveBeenCalledOnce()
  })

  it('refuses another terminal that binds the coordinator’s Run with run-use', async () => {
    await authorize([card({ count: 2 })])
    await h.call(
      'orchestration.runUse',
      { id: h.activeRunId, from: 'term_second' },
      { orchestrationCompatibilityEvidence: evidenceFor('term_second') }
    )
    await expect(start({}, 'term_second')).rejects.toMatchObject(refusedFor('no_grant'))
    expect(h.runtime.createTerminal).not.toHaveBeenCalled()
  })

  it('binds an authorization to the Run it first starts agents in', async () => {
    await authorize([card({ count: 2 })])
    await start()
    await h.call(
      'orchestration.runCreate',
      { from: 'term_coord', objective: 'An unrelated task' },
      { orchestrationCompatibilityEvidence: evidenceFor('term_coord') }
    )
    await expect(start({ spec: 'Unrelated work' })).rejects.toMatchObject(
      refusedFor('out_of_scope')
    )
    expect(h.runtime.createTerminal).toHaveBeenCalledOnce()
  })

  it('lets a newer card message replace the unused part of an older one', async () => {
    await authorize([card({ count: 3 })])
    await authorize([card({ agent: 'codex', label: 'Codex', model: undefined, effort: undefined })])
    await expect(start()).rejects.toMatchObject(refusedFor('mismatch'))
    expect(
      outcome(await start({ agent: 'codex', model: undefined, effort: undefined })).state
    ).toBe('ready')
  })

  it('hands new work only to a worker this authorization started in this Run', async () => {
    await authorize([card()])
    await start()
    const worker = h.db.findActiveDispatchForAssignee('term_probe_1')!
    h.settle(worker.task_id, worker.id, 'succeeded')
    const reuse = (terminal: string) =>
      start({
        spec: `Follow-up for ${terminal}`,
        terminal,
        agent: undefined,
        model: undefined,
        effort: undefined
      })
    expect(outcome(await reuse('term_probe_1')).state).toBe('ready')
    await expect(reuse('term_other')).rejects.toMatchObject(refusedFor('reuse_unauthorized'))
    expect(h.runtime.createTerminal).toHaveBeenCalledOnce()
  })

  it('keeps the current cards while newer ones are still on their way to the agent', async () => {
    await authorize([card({ count: 2 })])
    expect(outcome(await start({ spec: 'A' })).state).toBe('ready')
    const codex = card({ agent: 'codex', label: 'Codex', model: undefined, effort: undefined })
    const queued = { submissionId: 'submit_queued' }
    await authorize([codex], { ...queued, delivered: null })
    const asCodex = { agent: 'codex', model: undefined, effort: undefined }
    await expect(start({ spec: 'Codex early', ...asCodex })).rejects.toMatchObject(
      refusedFor('mismatch')
    )
    expect(outcome(await start({ spec: 'B' })).state).toBe('ready')

    await terminalCall('agentDelegation.settleTerminal', {
      ptyId: 'pty_term_coord',
      ...queued,
      delivered: true
    })
    await expect(start({ spec: 'C' })).rejects.toMatchObject(refusedFor('mismatch'))
    expect(outcome(await start({ spec: 'Codex', ...asCodex })).state).toBe('ready')
  })

  it('leaves no authorization behind for cards whose message never reached the agent', async () => {
    await authorize([card()])
    await authorize([card({ count: 5 })], { delivered: false })
    expect(outcome(await start({ spec: 'A' })).state).toBe('ready')
    await expect(start({ spec: 'B' })).rejects.toMatchObject(refusedFor('exhausted'))
  })

  it('refuses a terminal whose agent restarted since this authorization started it', async () => {
    await authorize([card()])
    await start()
    const worker = h.db.findActiveDispatchForAssignee('term_probe_1')!
    h.settle(worker.task_id, worker.id, 'succeeded')
    const authority = vi.mocked(h.runtime.getOrchestrationDispatchAuthority)
    const original = authority.getMockImplementation()!
    authority.mockImplementation((handle) => {
      const current = original(handle)
      return handle === 'term_probe_1' && current
        ? { ...current, processIncarnation: 'runtime_test:term_probe_1:2' }
        : current
    })
    await expect(
      start({
        spec: 'Follow-up',
        terminal: 'term_probe_1',
        agent: undefined,
        model: undefined,
        effort: undefined
      })
    ).rejects.toMatchObject(refusedFor('reuse_unauthorized'))
  })

  it('matches a card that leaves model and effort to the defaults', async () => {
    await authorize([card({ model: undefined, effort: undefined })])
    expect(outcome(await start({ model: undefined, effort: undefined })).state).toBe('ready')
  })

  async function failFirstStart(): Promise<{ taskId: string; dispatchId: string }> {
    vi.mocked(h.runtime.waitForTerminal).mockResolvedValueOnce({
      handle: 'term_probe_1',
      condition: 'tui-idle',
      satisfied: false,
      status: 'running',
      exitCode: null
    })
    const first = outcome(await start())
    expect(first.state).toBe('failed')
    return first
  }

  function retry(
    first: { taskId: string; dispatchId: string },
    asked: Record<string, unknown> = {}
  ) {
    return start({ spec: undefined, task: first.taskId, retryOf: first.dispatchId, ...asked })
  }

  it('lets a retry reuse its failed attempt’s agent once that attempt is closed', async () => {
    await authorize([card()])
    const first = await failFirstStart()
    expect(outcome(await retry(first)).state).toBe('ready')
    expect(h.runtime.closeTerminal).toHaveBeenCalled()
    expect(h.runtime.createTerminal).toHaveBeenCalledTimes(2)
    await expect(start({ spec: 'Another task' })).rejects.toMatchObject(refusedFor('exhausted'))
  })

  it('refuses a retry that asks for a different launch, before releasing its attempt', async () => {
    await authorize([card({ count: 2 })])
    const first = await failFirstStart()
    await expect(retry(first, { model: 'sonnet' })).rejects.toMatchObject(
      refusedFor('retry_mismatch')
    )
    expect(h.runtime.createTerminal).toHaveBeenCalledOnce()
    expect(h.runtime.closeTerminal).not.toHaveBeenCalled()
    expect(h.db.getWorkerTerminalResourceByOwner(first.dispatchId)?.release_state).toBe(
      'not_requested'
    )
  })

  it('refuses a retry while the failed attempt’s agent is not proven closed', async () => {
    await authorize([card()])
    const first = await failFirstStart()
    vi.mocked(h.runtime.closeTerminal).mockImplementation(async () => ({
      handle: 'term_probe_1',
      tabId: 'tab-probe-1',
      ptyKilled: false
    }))
    await expect(retry(first)).rejects.toMatchObject({
      code: WORKER_RETRY_PRIOR_ATTEMPT_LIVE_CODE,
      data: expect.objectContaining({ dispatchId: first.dispatchId })
    })
    expect(h.runtime.createTerminal).toHaveBeenCalledOnce()
    expect(h.db.getWorkerTerminalResourceByOwner(first.dispatchId)?.release_state).not.toBe(
      'released'
    )
  })
})
