import { expect, it, onTestFinished } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'
import { claimAgentDelegationSlotInTransaction } from './agent-delegation-grant-store'

const holderKey = 'test-coordinator'
const request = { agent: 'claude', model: 'opus', effort: 'high' }

function grants() {
  const db = new OrchestrationDb(':memory:')
  onTestFinished(() => db.close())
  const record = (sourceKey: string, awaitingDelivery = false) =>
    db.recordAgentDelegationGrants({
      holderKey,
      sourceKey,
      sourceMessageId: sourceKey,
      awaitingDelivery,
      cards: [
        {
          agent: request.agent,
          label: 'Claude',
          count: 1,
          task: sourceKey,
          model: { id: request.model, label: 'Opus' },
          effort: request.effort
        }
      ]
    })
  const authorize = (sourceKey: string, awaitingDelivery = false) => {
    const id = record(sourceKey, awaitingDelivery)
    if (!id) {
      throw new Error(`Expected a new authorization for ${sourceKey}`)
    }
    return id
  }
  const active = () =>
    db
      .listAgentDelegationGrants(holderKey)
      .filter((grant) => grant.superseded_by === null && !grant.awaiting_delivery)
      .map((grant) => grant.task)
  const claim = (id: string, retryOf?: string, deliveredMessageIds?: ReadonlySet<string>) => {
    db.db.exec('BEGIN IMMEDIATE')
    try {
      claimAgentDelegationSlotInTransaction(
        db.db,
        { holderKey, ...request, deliveredMessageIds },
        { id, runId: 'run-test', taskId: 'task-test', retryOf }
      )
      db.db.exec('COMMIT')
    } catch (error) {
      db.db.exec('ROLLBACK')
      throw error
    }
  }
  return { db, record, authorize, active, claim }
}

it('withdraws an older queued card without reviving it or an earlier allowance', () => {
  const h = grants()
  h.authorize('A')
  const b = h.authorize('B')
  const c = h.authorize('C')
  h.db.revokeAgentDelegationAuthorization(b)
  expect(h.active()).toEqual(['C'])
  expect(h.record('B')).toBeNull()
  expect(h.active()).toEqual(['C'])

  h.db.revokeAgentDelegationAuthorization(c)
  expect(h.active()).toEqual(['A'])
})

it('replaying a withdrawal cannot restore an allowance over a newer card', () => {
  const h = grants()
  h.authorize('A')
  const b = h.authorize('B')
  h.db.revokeAgentDelegationAuthorization(b)
  expect(h.active()).toEqual(['A'])
  h.authorize('C')

  h.db.revokeAgentDelegationAuthorization(b)
  expect(h.record('B')).toBeNull()
  expect(h.active()).toEqual(['C'])
})

it('keeps current work authorized until a queued replacement reaches the agent', () => {
  const h = grants()
  h.authorize('A')
  h.authorize('B', true)

  h.claim('current-work')
  expect(h.active()).toEqual(['A'])
  expect(() => h.claim('premature-replacement')).toThrowError(
    expect.objectContaining({ code: 'agent_delegation_unauthorized' })
  )

  h.claim('delivered-replacement', undefined, new Set(['B']))
  expect(h.active()).toEqual(['B'])
  expect(() => h.claim('extra-worker')).toThrowError(
    expect.objectContaining({ code: 'agent_delegation_unauthorized' })
  )
})

it('does not revive a withdrawn card when its delivery confirmation arrives late', () => {
  const h = grants()
  h.authorize('A')
  h.authorize('B', true)
  h.db.settleAgentDelegationDelivery({ holderKey, sourceKey: 'B', delivered: false })
  h.db.settleAgentDelegationDelivery({ holderKey, sourceKey: 'B', delivered: true })

  expect(h.active()).toEqual(['A'])
  expect(h.record('B', true)).toBeNull()
  h.claim('current-work', undefined, new Set(['B']))
  expect(() => h.claim('late-delivery-worker', undefined, new Set(['B']))).toThrowError(
    expect.objectContaining({ code: 'agent_delegation_unauthorized' })
  )
})

it('revoking a spent card preserves its existing retry without restoring older quota', () => {
  const h = grants()
  h.authorize('A')
  const b = h.authorize('B')
  h.claim('attempt-one')
  h.db.revokeAgentDelegationAuthorization(b)

  expect(h.active()).toEqual([])
  expect(() => h.claim('unrelated')).toThrowError(
    expect.objectContaining({ code: 'agent_delegation_unauthorized' })
  )
  h.claim('attempt-two', 'attempt-one')
  expect(h.record('B')).toBeNull()
  expect(h.db.listAgentDelegationGrants(holderKey).find((grant) => grant.task === 'B')?.used).toBe(
    1
  )
})
