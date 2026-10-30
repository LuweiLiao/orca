import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './db'
import {
  OrchestrationStructuredMailboxPointerDelivery,
  type StructuredMailboxPointerHost
} from './structured-mailbox-pointer-delivery'
import { StructuredStaleMailReminder } from './structured-stale-mail-reminder'

const MAILBOX = 'dispatch:ctx_draw'
const SESSION = 'session-draw'

describe('reminding a busy session of mail it was pointed at but never read', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  function rig() {
    db = new OrchestrationDb(':memory:')
    const open = db
    const sqlite = open.db
    let clock = 1_000_000
    const send = vi.fn<StructuredMailboxPointerHost['send']>(async () => ({
      kind: 'sent',
      state: 'accepted'
    }))
    const resolveStructuredTarget = (handle: string) =>
      handle === MAILBOX ? { sessionId: SESSION, dispatchId: 'ctx_draw' } : null
    const delivery = new OrchestrationStructuredMailboxPointerDelivery({
      getDb: () => open,
      getMessageWaiters: () => undefined,
      resolveStructuredTarget,
      getCliCommand: () => 'orca',
      senderName: () => null,
      host: {
        readSessionFacts: async () => ({ submissions: [] }),
        hasActionablePromptNow: () => false,
        isWorkingNow: () => true,
        currentFence: () => 1,
        currentContextClearOperationId: () => undefined,
        send
      }
    })
    // Wired as the runtime wires it: journal activity drives both.
    const reminder = new StructuredStaleMailReminder({
      getDb: () => open,
      ownerSessionId: (handle) => resolveStructuredTarget(handle)?.sessionId,
      redeliver: (handle) => delivery.deliverForHandle(handle),
      now: () => clock
    })
    const insert = (type: 'status' | 'heartbeat', priority: 'normal' | 'high' = 'normal') => {
      const message = open.insertMessage({
        from: 'term_coordinator',
        to: MAILBOX,
        subject: 'use u6, not g6',
        type,
        priority
      })
      open.markAsDelivered([message.id], MAILBOX)
      return message
    }
    const age = (minutes: number) =>
      sqlite
        .prepare(
          `UPDATE messages SET delivered_at = datetime('now', ?) WHERE delivered_at IS NOT NULL`
        )
        .run(`-${minutes} minutes`)
    // A journal edge from a later point in the same long turn.
    const activity = async (advanceMs = 61_000) => {
      clock += advanceMs
      delivery.onJournalActivity(SESSION)
      reminder.sweep(SESSION)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { open, send, insert, age, activity }
  }

  it('points unread mail again at 10 and 30 minutes, then leaves it to check', async () => {
    const { open, send, insert, age, activity } = rig()
    const followUp = insert('status', 'high')

    age(9)
    await activity()
    expect(send).not.toHaveBeenCalled()

    age(11)
    await activity()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0].body.blocks[0]).toMatchObject({
      text: expect.stringContaining('1 orchestration message (status; 1 high priority)')
    })
    expect(open.getMessageById(followUp.id)?.delivered_at).not.toBeNull()

    // Within the sweep interval nothing is read again.
    age(31)
    await activity(1_000)
    expect(send).toHaveBeenCalledTimes(1)

    await activity()
    expect(send).toHaveBeenCalledTimes(2)

    age(120)
    await activity()
    expect(send).toHaveBeenCalledTimes(2)
  })

  // A reused worker's check reads only its current Dispatch, so a settled one's leftover mail
  // would be pointed at forever.
  it('leaves mail in a settled Dispatch mailbox alone', async () => {
    const { open, send, insert, age, activity } = rig()
    const run = open.createRun({
      objective: 'draw',
      coordinatorHandle: 'term-coordinator',
      coordinatorPaneKey: 'tab-coordinator:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = open.createTask({ spec: 'draw', runId: run.id })
    open.db
      .prepare(
        `INSERT INTO dispatch_contexts (id, run_id, task_id, assignee_handle, status, created_at)
         VALUES ('ctx_draw', ?, ?, 'structworker_draw', 'completed', '2026-10-30 05:02:31')`
      )
      .run(run.id, task.id)
    insert('status', 'high')

    age(45)
    await activity()
    expect(send).not.toHaveBeenCalled()
  })

  it('leaves heartbeats, read mail and mail inside an unacked batch alone', async () => {
    const { open, send, insert, age, activity } = rig()
    insert('heartbeat')
    const read = insert('status')
    open.markAsRead([read.id])
    const fetched = insert('status')
    vi.spyOn(open, 'getOutstandingMailboxDelivery').mockReturnValue({
      id: 'delivery_1',
      messageIds: [fetched.id]
    })

    age(45)
    await activity()
    expect(send).not.toHaveBeenCalled()
  })
})
