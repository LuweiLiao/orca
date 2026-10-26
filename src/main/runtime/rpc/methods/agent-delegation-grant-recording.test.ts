import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES } from '../../../ipc/desktop-renderer-runtime-capabilities'
import { DESKTOP_RPC_CALLER } from '../rpc-caller-identity'
import { rpcContext, runtimeStub } from './agent-launch.test-fixture'
import { sendStructuredAgentSessionForClient } from './structured-agent-session-send-compatibility'
import { STRUCTURED_AGENT_SESSION_QUEUED_METHODS } from './structured-agent-session-queued-methods'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import type { AgentJournalSubmission } from '../../../../shared/agent-session-journal-types'
import { orchestrationReferenceToken } from '../../../../shared/native-chat-orchestration-reference'
import { ORCA_CLI_RUNTIME_CLIENT_CAPABILITY } from '../../../../shared/agent-delegation-grant'
import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/agent-launch-runtime-capability'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { OrchestrationDb } from '../../orchestration/db'
import { sessionDelegationHolderKey } from '../../agent-delegation-holder'
import { isOrcaSessionId } from '../../../../shared/orca-session-address'
import { eraseRpcMethods, type RpcContext } from '../core'

const SESSION_ID = 'session_alpha_001'
const SELECTION = {
  agent: 'claude',
  label: 'Claude',
  count: 2,
  task: 'Review',
  model: { id: 'opus', label: 'Opus' }
}
const CARD = orchestrationReferenceToken(SELECTION, '2 Claude agents')

function submission(queuedMessageId?: string): AgentJournalSubmission {
  return {
    clientMessageId: 'm1',
    fence: 2,
    payloadFingerprint: 'fp-1',
    dispatchState: queuedMessageId ? 'pending' : 'accepted',
    providerItemId: 'codex:thread-1:turn-1:0',
    reason: null,
    submittedAt: 0,
    resolvedAt: 0,
    ...(queuedMessageId ? { queuedMessageId } : {})
  }
}

type Host = Pick<
  StructuredAgentSessionHost,
  'sessionAgent' | 'send' | 'waitForSendSettlement' | 'queuedMessageUpdate' | 'queuedMessageDelete'
>
type HostStub = { [K in keyof Host]: ReturnType<typeof vi.fn> } & {
  deps: { store: { getRecord: () => null; listRecords: () => [] } }
}

function accepted(queuedMessageId?: string) {
  return {
    ok: true as const,
    replayed: false,
    fence: 2,
    cursor: { epoch: 'e1', sequence: 2 },
    value: { clientMessageId: 'm1', submission: submission(queuedMessageId) }
  }
}

// Real handlers and grant store; the provider host is a stub.
describe('a person’s submitted cards authorize their chat', () => {
  let db: OrchestrationDb
  let host: HostStub

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    host = {
      sessionAgent: vi.fn(() => 'codex'),
      send: vi.fn(async () => accepted()),
      waitForSendSettlement: vi.fn(async () => undefined),
      queuedMessageUpdate: vi.fn(async () => accepted()),
      queuedMessageDelete: vi.fn(async () => ({
        ...accepted(),
        value: { deleted: true, messageId: 'q1' }
      })),
      deps: { store: { getRecord: () => null, listRecords: () => [] } }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers reach only these host methods.
    setStructuredAgentSessionHost(host as unknown as StructuredAgentSessionHost)
  })
  afterEach(() => {
    setStructuredAgentSessionHost(null)
    db.close()
  })

  const PERSON: Partial<RpcContext> = {
    clientId: 'desktop-renderer',
    caller: DESKTOP_RPC_CALLER,
    clientKind: 'runtime',
    clientCapabilities: DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES
  }

  function context(callerContext: Partial<RpcContext>): RpcContext {
    const runtime = {
      ...runtimeStub(),
      getOrchestrationDb: () => db,
      getExistingOrchestrationDb: () => db
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub adds the two database accessors these handlers read.
    return rpcContext(runtime as unknown as ReturnType<typeof runtimeStub>, callerContext)
  }

  type SendOptions = { caller?: Partial<RpcContext>; operationId?: string; cards?: boolean }

  /** What the composer sends: the text with each pill's token, and the pills beside it. */
  function send(text: string, options: SendOptions = {}) {
    return sendStructuredAgentSessionForClient(
      {
        envelope: {
          sessionId: SESSION_ID,
          clientOperationId: options.operationId ?? 'op-1',
          expectedRuntimeFence: 1,
          payloadFingerprint: 'fp-1'
        },
        body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] },
        ...(options.cards === false ? {} : { orchestrationCards: [SELECTION] })
      },
      context(options.caller ?? PERSON)
    )
  }

  function grants() {
    if (!isOrcaSessionId(SESSION_ID)) {
      throw new Error('fixture session id')
    }
    return db.listAgentDelegationGrants(sessionDelegationHolderKey(SESSION_ID))
  }

  function usable() {
    return grants().filter((grant) => grant.superseded_by === null)
  }

  it('records the composer’s cards once per submission, awaiting the agent', async () => {
    await send(`Please split this. ${CARD}`)
    await send(`Please split this. ${CARD}`)
    expect(grants()).toEqual([
      expect.objectContaining({
        agent: 'claude',
        model: 'opus',
        effort: null,
        count: 2,
        used: 0,
        source_message_id: 'op-1',
        awaiting_delivery: 1
      })
    ])
  })

  it('records the cards before the host takes the message', async () => {
    host.send.mockImplementation(async () => {
      expect(usable()).toHaveLength(1)
      return accepted()
    })
    await send(CARD)
    expect(host.send).toHaveBeenCalledOnce()
    expect(host.send.mock.calls[0]?.[1]).not.toHaveProperty('orchestrationCards')
  })

  it('records nothing for a card URL sent as text without the composer’s pill', async () => {
    await send(`Please split this. ${CARD}`, { cards: false })
    expect(grants()).toEqual([])
  })

  it('records nothing for a pill whose card the text does not carry', async () => {
    await send('Please split this.')
    expect(grants()).toEqual([])
  })

  it.each([
    { name: 'the local CLI socket', caller: {} },
    {
      name: 'the paired orca CLI',
      caller: {
        pairedDeviceId: 'device-cli',
        clientKind: 'runtime' as const,
        // Even one that claims to read chats.
        clientCapabilities: [
          AGENT_LAUNCH_RUNTIME_CAPABILITY,
          ORCA_CLI_RUNTIME_CLIENT_CAPABILITY,
          STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
        ]
      }
    }
  ])('records nothing for a message sent by $name', async ({ caller }) => {
    await send(CARD, { caller })
    expect(host.send).toHaveBeenCalledOnce()
    expect(grants()).toEqual([])
  })

  it.each([
    ['a quoted line', `> ${CARD}`],
    ['inline code', `\`${CARD}\``],
    ['a fenced block', `\`\`\`\n${CARD}\n\`\`\``]
  ])('records nothing for a card shown in %s', async (_name, text) => {
    await send(text)
    expect(grants()).toEqual([])
  })

  it('withdraws the cards of a message the host refuses or loses', async () => {
    host.send.mockResolvedValueOnce({
      ok: false,
      refusal: { code: 'agent_session_operation_invalid' }
    })
    await send(CARD, { operationId: 'op-refused' })
    host.send.mockRejectedValueOnce(new Error('host gone'))
    await expect(send(CARD, { operationId: 'op-lost' })).rejects.toThrow('host gone')
    expect(grants()).toHaveLength(2)
    expect(usable()).toEqual([])
  })

  it('withdraws a queued message’s cards when the person deletes it, and replaces them on edit', async () => {
    const methods = eraseRpcMethods(STRUCTURED_AGENT_SESSION_QUEUED_METHODS)
    const call = (name: string, params: Record<string, unknown>) => {
      const method = methods.find((candidate) => candidate.name === name)!
      return method.handler(method.params!.parse(params), context(PERSON))
    }
    const envelope = (operationId: string) => ({
      sessionId: SESSION_ID,
      clientOperationId: operationId,
      expectedRuntimeFence: 1,
      payloadFingerprint: 'a'.repeat(64)
    })
    host.send.mockResolvedValueOnce(accepted('q1'))
    await send(CARD, { operationId: 'op-queued' })
    expect(usable()).toEqual([expect.objectContaining({ source_message_id: 'q1' })])

    const codex = { agent: 'codex', label: 'Codex', count: 1, task: 'Review' }
    const update = {
      envelope: envelope('op-edit'),
      messageId: 'q1',
      expectedBodyFingerprint: 'a'.repeat(64),
      text: orchestrationReferenceToken(codex, '1 Codex agent'),
      orchestrationCards: [codex]
    }
    await call('agentSession.queuedMessageUpdate', update)
    await call('agentSession.queuedMessageUpdate', update)
    expect(host.queuedMessageUpdate.mock.calls[0]?.[1]).not.toHaveProperty('orchestrationCards')
    expect(usable()).toEqual([
      expect.objectContaining({ agent: 'codex', count: 1, source_message_id: 'q1' })
    ])

    await call('agentSession.queuedMessageDelete', {
      envelope: envelope('op-delete'),
      messageId: 'q1'
    })
    expect(usable()).toEqual([])
  })

  it('keeps a queued card’s pill through a text edit, but not one the edit changed', async () => {
    const methods = eraseRpcMethods(STRUCTURED_AGENT_SESSION_QUEUED_METHODS)
    const edit = (operationId: string, text: string) => {
      const method = methods.find(
        (candidate) => candidate.name === 'agentSession.queuedMessageUpdate'
      )!
      const params = {
        envelope: {
          sessionId: SESSION_ID,
          clientOperationId: operationId,
          expectedRuntimeFence: 1,
          payloadFingerprint: 'a'.repeat(64)
        },
        messageId: 'q1',
        expectedBodyFingerprint: 'a'.repeat(64),
        text
      }
      return method.handler(method.params!.parse(params), context(PERSON))
    }
    host.send.mockResolvedValueOnce(accepted('q1'))
    await send(`Split this. ${CARD}`, { operationId: 'op-queued' })

    await edit('op-reword', `Split this differently. ${CARD}`)
    expect(usable()).toEqual([
      expect.objectContaining({ agent: 'claude', count: 2, source_message_id: 'q1' })
    ])

    const more = orchestrationReferenceToken({ ...SELECTION, count: 5 }, '5 Claude agents')
    await edit('op-more', `Split this differently. ${more}`)
    expect(usable()).toEqual([])
    // Withdrawn by that edit, the card is not restored by typing it back.
    await edit('op-back', `Split this. ${CARD}`)
    expect(usable()).toEqual([])
  })

  it('leaves a later edit’s cards alone when an earlier edit replays late', async () => {
    const method = eraseRpcMethods(STRUCTURED_AGENT_SESSION_QUEUED_METHODS).find(
      (candidate) => candidate.name === 'agentSession.queuedMessageUpdate'
    )!
    const edit = (operationId: string, text: string, orchestrationCards?: unknown[]) =>
      method.handler(
        method.params!.parse({
          envelope: {
            sessionId: SESSION_ID,
            clientOperationId: operationId,
            expectedRuntimeFence: 1,
            payloadFingerprint: 'a'.repeat(64)
          },
          messageId: 'q1',
          expectedBodyFingerprint: 'a'.repeat(64),
          text,
          ...(orchestrationCards ? { orchestrationCards } : {})
        }),
        context(PERSON)
      )
    host.send.mockResolvedValueOnce(accepted('q1'))
    await send(CARD, { operationId: 'op-queued' })
    const codex = { agent: 'codex', label: 'Codex', count: 1, task: 'Review' }
    await edit('op-1', CARD, [SELECTION])
    await edit('op-2', orchestrationReferenceToken(codex, '1 Codex agent'), [codex])
    host.queuedMessageUpdate.mockResolvedValueOnce({ ...accepted(), replayed: true })
    await edit('op-1', CARD, [SELECTION])
    expect(usable()).toEqual([expect.objectContaining({ agent: 'codex', source_message_id: 'q1' })])
  })
})
