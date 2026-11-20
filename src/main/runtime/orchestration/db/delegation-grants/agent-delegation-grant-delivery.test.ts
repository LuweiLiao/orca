import { expect, it, onTestFinished } from 'vitest'
import { AGENT_DELEGATION_UNAUTHORIZED_CODE } from '../../../../../shared/agent-delegation-grant'
import { OrchestrationDb } from '../orchestration-db'
import { claimAgentDelegationSlotInTransaction } from './agent-delegation-grant-store'

const holderKey = 'orca_session_id:session_alpha_001'

function chat() {
  const db = new OrchestrationDb(':memory:')
  onTestFinished(() => db.close())
  const send = (messageId: string, agent: string) =>
    db.recordAgentDelegationGrants({
      holderKey,
      sourceKey: `desktop:${messageId}`,
      cards: [{ agent, label: agent, count: 1, task: messageId }],
      sourceMessageId: messageId,
      awaitingDelivery: true
    })
  let dispatches = 0
  const claim = (agent: string, delivered: string[]) => {
    db.db.exec('BEGIN IMMEDIATE')
    try {
      claimAgentDelegationSlotInTransaction(
        db.db,
        { holderKey, agent, model: null, effort: null, deliveredMessageIds: new Set(delivered) },
        { id: `ctx_${++dispatches}`, taskId: `task_${dispatches}`, runId: 'run_1' }
      )
      db.db.exec('COMMIT')
    } catch (error) {
      db.db.exec('ROLLBACK')
      throw error
    }
  }
  return { send, claim }
}

const refused = { code: AGENT_DELEGATION_UNAUTHORIZED_CODE }

// Real store; the delivered set stands in for the chat journal's handed-over submissions.
it('authorizes nothing until the chat journal shows the message handed to the agent', () => {
  const { send, claim } = chat()
  send('m1', 'claude')
  expect(() => claim('claude', [])).toThrow(expect.objectContaining(refused))
  claim('claude', ['m1'])
})

it('keeps a delivered authorization current while a newer message is still queued', () => {
  const { send, claim } = chat()
  send('m1', 'claude')
  send('m2', 'codex')
  // Only the first reached the agent, so the second neither works yet nor replaces the first.
  claim('claude', ['m1'])
  expect(() => claim('codex', ['m1'])).toThrow(expect.objectContaining(refused))
})

it('replaces the earlier authorization once the newer message reaches the agent', () => {
  const { send, claim } = chat()
  send('m1', 'claude')
  send('m2', 'codex')
  claim('codex', ['m1', 'm2'])
  expect(() => claim('claude', ['m1', 'm2'])).toThrow(
    expect.objectContaining({ ...refused, data: expect.objectContaining({ reason: 'mismatch' }) })
  )
})
