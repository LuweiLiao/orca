import './rpc/unused-default-rpc-methods.test-fixture'
// A chat working a Dispatch whose turn ends cleanly without worker_done tells the coordinator's Run,
// since nothing else wakes a coordinator that ended its own turn.

import { describe, expect, it, vi } from 'vitest'
import { formatOrcaSessionAddress } from '../../shared/orca-session-address'
import { testOrcaSessionId } from '../../shared/orca-session-address-test-fixture'
import { idOf } from './rpc/orchestration-session-caller-test-fixture'
import {
  COORDINATOR,
  PEER_CHAT,
  WAIT,
  call,
  connectionFor,
  coordinatorRunAndTask,
  db,
  host,
  openChat,
  runtime,
  settleTurn
} from './structured-chat-coordinator-mail-rig.test-fixture'

const WORKER = formatOrcaSessionAddress(testOrcaSessionId(PEER_CHAT))

async function dispatchToWorkerChat() {
  await openChat(COORDINATOR)
  const worker = await openChat(PEER_CHAT)
  const { runId, taskId } = await coordinatorRunAndTask()
  const dispatched = call(
    'orchestration.dispatch',
    { task: taskId, to: WORKER, inject: true },
    { sessionId: COORDINATOR }
  )
  await vi.waitFor(() => expect(worker.turns).toHaveLength(1), WAIT)
  return { runId, taskId, dispatched }
}

function escalationsTo(runId: string): { subject: string; payload: Record<string, unknown> }[] {
  return db.db
    .prepare(`SELECT subject, payload FROM messages WHERE to_handle = ? AND type = 'escalation'`)
    .all(`run:${runId}`)
    .map((row) => {
      if (typeof row.subject !== 'string' || typeof row.payload !== 'string') {
        throw new Error('invalid mail row')
      }
      return { subject: row.subject, payload: JSON.parse(row.payload) }
    })
}

describe('a chat worker whose turn ends without worker_done', () => {
  it('tells the Run that dispatched it, once, and keeps the task assigned', async () => {
    vi.spyOn(runtime, 'isChatWorkerErrorEscalationEnabled').mockReturnValue(true)
    const notified = vi.spyOn(runtime, 'notifyMessageArrived')
    const { runId, dispatched } = await dispatchToWorkerChat()
    await settleTurn(PEER_CHAT, 0, 'completed')
    const dispatchId = idOf((await dispatched).dispatch)

    await vi.waitFor(() => expect(escalationsTo(runId)).toHaveLength(1), WAIT)
    expect(escalationsTo(runId)[0]).toMatchObject({
      subject: 'Agent ended its turn without reporting',
      payload: { dispatchId, reason: 'turn_ended_without_worker_done', turnOutcome: 'success' }
    })
    expect(notified).toHaveBeenCalledWith(`run:${runId}`, 'escalation')
    expect(db.getDispatchContextById(dispatchId)).toMatchObject({ status: 'dispatched' })

    host.publishConversationName(PEER_CHAT)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(escalationsTo(runId)).toHaveLength(1)
  })

  it('sends nothing when the turn reported worker_done before it ended', async () => {
    vi.spyOn(runtime, 'isChatWorkerErrorEscalationEnabled').mockReturnValue(true)
    const { runId, taskId, dispatched } = await dispatchToWorkerChat()
    const worker = connectionFor(PEER_CHAT)
    const turn = worker.turns[0]!
    const notify = (method: string, params: unknown) =>
      worker.handlers.onNotification?.(method, params)
    notify('turn/started', { turn: { id: 'turn-1' } })
    notify('item/completed', {
      item: {
        type: 'userMessage',
        id: `echo-${turn.clientUserMessageId}`,
        clientId: turn.clientUserMessageId,
        content: [{ type: 'text', text: 'task' }]
      }
    })
    await host.flushStreamedEvents(PEER_CHAT)
    const dispatchId = idOf((await dispatched).dispatch)
    await call(
      'orchestration.send',
      {
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({ taskId, dispatchId, outcome: 'succeeded' })
      },
      { sessionId: PEER_CHAT }
    )
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
    await host.flushStreamedEvents(PEER_CHAT)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(db.getDispatchContextById(dispatchId)).toMatchObject({ status: 'completed' })
    expect(escalationsTo(runId)).toHaveLength(0)
  })

  it('sends nothing while the Orchestration switch is off', async () => {
    vi.spyOn(runtime, 'isChatWorkerErrorEscalationEnabled').mockReturnValue(false)
    const { runId, dispatched } = await dispatchToWorkerChat()
    await settleTurn(PEER_CHAT, 0, 'completed')
    await dispatched

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(escalationsTo(runId)).toHaveLength(0)
  })
})
