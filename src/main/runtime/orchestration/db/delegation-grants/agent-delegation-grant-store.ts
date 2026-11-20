import type Database from '../../../../sqlite/sync-database'
import {
  agentDelegationRequestOfCard,
  type AgentDelegationRequest
} from '../../../../../shared/agent-delegation-grant'
import type { OrchestrationAgentSelection } from '../../../../../shared/native-chat-orchestration-reference'
import type { OrchestrationError } from '../../orchestration-error'
import { noConversation, recordSlotDispatch, unauthorized } from './agent-delegation-refusal'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import {
  activateDeliveredAgentDelegationsInTransaction,
  settleAgentDelegationDelivery
} from './agent-delegation-grant-delivery'
import {
  bindAgentDelegationAuthorizationMessage,
  revokeAgentDelegationAuthorization,
  listAgentDelegationAuthorizationsForMessage
} from './agent-delegation-grant-withdrawal'
export {
  bindAgentDelegationAuthorizationMessage,
  revokeAgentDelegationAuthorization,
  listAgentDelegationAuthorizationsForMessage
}

export { AGENT_DELEGATION_GRANT_TABLES_SQL } from './agent-delegation-grant-tables'
export {
  claimAgentDelegationReuseInTransaction,
  type AgentDelegationReuse
} from './agent-delegation-grant-reuse'

export type AgentDelegationGrantRow = {
  id: string
  authorization_id: string
  holder_key: string
  source_key: string
  source_message_id: string | null
  agent: string
  model: string | null
  effort: string | null
  count: number
  task: string
  run_id: string | null
  superseded_by: string | null
  awaiting_delivery: number
  created_at: string
  used: number
}

/**
 * Who asks; `holderKey` is null for a caller no person can authorize. `deliveredMessageIds` are
 * the holder's messages its agent has been handed, read from the chat's journal: cards still
 * queued or refused there authorize nothing yet.
 */
export type AgentDelegationClaim = AgentDelegationRequest & {
  holderKey: string | null
  deliveredMessageIds?: ReadonlySet<string>
}

const GRANT_SELECT = `SELECT g.*,
  (SELECT COUNT(*) FROM agent_delegation_slots s WHERE s.grant_id = g.id) AS used
  FROM agent_delegation_grants g`

function readGrants(db: Database.Database, holderKey: string): AgentDelegationGrantRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: GRANT_SELECT reads every agent_delegation_grants column plus the integer `used` count.
  return db
    .prepare(`${GRANT_SELECT} WHERE g.holder_key = ? ORDER BY g.created_at, g.rowid`)
    .all(holderKey) as AgentDelegationGrantRow[]
}

function inWriteTransaction<T>(db: Database.Database, run: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = run()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Records one submission's cards as one authorization and supersedes the holder's earlier ones.
 * A replayed submission records nothing. Returns the new authorization id, or null.
 */
export function recordAgentDelegationGrants(
  this: OrchestrationDb,
  input: {
    holderKey: string
    sourceKey: string
    cards: readonly OrchestrationAgentSelection[]
    sourceMessageId?: string
    /** Recorded inactive until the message is known to have reached the agent. */
    awaitingDelivery?: boolean
  }
): string | null {
  if (input.cards.length === 0) {
    return null
  }
  return inWriteTransaction(this.db, () => {
    const replayed = this.db
      .prepare('SELECT 1 FROM agent_delegation_grants WHERE source_key = ?')
      .get(`${input.sourceKey}#0`)
    if (replayed) {
      return null
    }
    const authorizationId = generateId('auth')
    // A message still on its way replaces nothing: the agent may be finishing the current task.
    if (!input.awaitingDelivery) {
      this.db
        .prepare(
          `UPDATE agent_delegation_grants SET superseded_by = ?
           WHERE holder_key = ? AND superseded_by IS NULL`
        )
        .run(authorizationId, input.holderKey)
    }
    const insert = this.db.prepare(
      `INSERT INTO agent_delegation_grants (id, authorization_id, holder_key, source_key,
         source_message_id, agent, model, effort, count, task, awaiting_delivery)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    input.cards.forEach((card, index) => {
      const request = agentDelegationRequestOfCard(card)
      insert.run(
        generateId('grant'),
        authorizationId,
        input.holderKey,
        `${input.sourceKey}#${index}`,
        input.sourceMessageId ?? null,
        request.agent,
        request.model,
        request.effort,
        card.count,
        card.task,
        input.awaitingDelivery ? 1 : 0
      )
    })
    return authorizationId
  })
}

export function listAgentDelegationGrants(
  this: OrchestrationDb,
  holderKey: string
): AgentDelegationGrantRow[] {
  return readGrants(this.db, holderKey)
}

function matches(grant: AgentDelegationGrantRow, request: AgentDelegationRequest): boolean {
  return (
    grant.agent === request.agent &&
    grant.model === request.model &&
    grant.effort === request.effort
  )
}

function describe(request: Pick<AgentDelegationRequest, 'agent' | 'model' | 'effort'>): string {
  return `${request.agent} (model ${request.model ?? 'default'}, effort ${request.effort ?? 'default'})`
}

function slotGrantOfDispatch(
  db: Database.Database,
  dispatchId: string
): { slotId: string; grant: AgentDelegationGrantRow } | null {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects one TEXT slot id and one TEXT grant id.
  const row = db
    .prepare(
      `SELECT sd.slot_id, s.grant_id FROM agent_delegation_slot_dispatches sd
       JOIN agent_delegation_slots s ON s.id = sd.slot_id WHERE sd.dispatch_id = ?`
    )
    .get(dispatchId) as { slot_id: string; grant_id: string } | undefined
  if (!row) {
    return null
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: GRANT_SELECT reads every agent_delegation_grants column plus the integer `used` count.
  const grant = db.prepare(`${GRANT_SELECT} WHERE g.id = ?`).get(row.grant_id) as
    | AgentDelegationGrantRow
    | undefined
  return grant ? { slotId: row.slot_id, grant } : null
}

/**
 * Spends one of the holder's authorized agents on a new Dispatch. Runs inside the caller's write
 * transaction, so concurrent starts serialize and the count check and the spend are atomic. A
 * retry stays on its failed attempt's slot when it asks for the same agent, model and effort.
 */
export function claimAgentDelegationSlotInTransaction(
  db: Database.Database,
  claim: AgentDelegationClaim,
  dispatch: { id: string; taskId: string; runId: string; retryOf?: string }
): void {
  const { holderKey } = claim
  if (!holderKey) {
    throw noConversation(`create a ${describe(claim)} agent`)
  }
  if (dispatch.retryOf) {
    const prior = slotGrantOfDispatch(db, dispatch.retryOf)
    if (prior) {
      if (
        prior.grant.holder_key !== holderKey ||
        prior.grant.run_id !== dispatch.runId ||
        !matches(prior.grant, claim)
      ) {
        throw unauthorized(
          `Dispatch ${dispatch.retryOf} was authorized as ${describe(prior.grant)}, so this retry cannot start a ${describe(claim)} agent in its place.`,
          { reason: 'retry_mismatch' }
        )
      }
      recordSlotDispatch(db, prior.slotId, dispatch.id)
      return
    }
  }
  if (claim.deliveredMessageIds) {
    activateDeliveredAgentDelegationsInTransaction(db, holderKey, claim.deliveredMessageIds)
  }
  const grants = readGrants(db, holderKey).filter((grant) => !grant.awaiting_delivery)
  const inScope = grants.filter(
    (grant) => grant.superseded_by === null && (grant.run_id ?? dispatch.runId) === dispatch.runId
  )
  const matching = inScope.filter((grant) => matches(grant, claim))
  const open = matching.find((grant) => grant.used < grant.count)
  if (!open) {
    throw refusal(claim, grants, inScope, matching)
  }
  if (open.run_id === null) {
    // The authorization's task is the Run it first starts agents in.
    db.prepare(
      'UPDATE agent_delegation_grants SET run_id = ? WHERE authorization_id = ? AND run_id IS NULL'
    ).run(dispatch.runId, open.authorization_id)
  }
  const slotId = generateId('slot')
  db.prepare('INSERT INTO agent_delegation_slots (id, grant_id, task_id) VALUES (?, ?, ?)').run(
    slotId,
    open.id,
    dispatch.taskId
  )
  recordSlotDispatch(db, slotId, dispatch.id)
}

function refusal(
  claim: AgentDelegationClaim,
  grants: readonly AgentDelegationGrantRow[],
  inScope: readonly AgentDelegationGrantRow[],
  matching: readonly AgentDelegationGrantRow[]
): OrchestrationError {
  if (matching.length > 0) {
    const used = matching.reduce((sum, grant) => sum + grant.used, 0)
    const count = matching.reduce((sum, grant) => sum + grant.count, 0)
    return unauthorized(
      `The user authorized ${count} ${describe(claim)} agent(s) for this task and ${used} are already started; finished or failed workers do not return them.`,
      { reason: 'exhausted', used, count }
    )
  }
  if (inScope.length > 0) {
    const authorized = inScope.map((grant) => `${grant.count} × ${describe(grant)}`).join('; ')
    return unauthorized(
      `The user authorized only ${authorized} for this task, not a ${describe(claim)} agent.`,
      { reason: 'mismatch' }
    )
  }
  return unauthorized(
    grants.length > 0
      ? 'No current user authorization covers this task: the earlier cards here belong to another Run or were replaced by a newer message.'
      : `No user authorization lets this conversation create a ${describe(claim)} agent.`,
    { reason: grants.length > 0 ? 'out_of_scope' : 'no_grant' }
  )
}

export type AgentDelegationGrantStoreMethods = {
  recordAgentDelegationGrants: typeof recordAgentDelegationGrants
  settleAgentDelegationDelivery: typeof settleAgentDelegationDelivery
  bindAgentDelegationAuthorizationMessage: typeof bindAgentDelegationAuthorizationMessage
  revokeAgentDelegationAuthorization: typeof revokeAgentDelegationAuthorization
  listAgentDelegationAuthorizationsForMessage: typeof listAgentDelegationAuthorizationsForMessage
  listAgentDelegationGrants: typeof listAgentDelegationGrants
}

export function attachAgentDelegationGrantStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    recordAgentDelegationGrants,
    settleAgentDelegationDelivery,
    bindAgentDelegationAuthorizationMessage,
    revokeAgentDelegationAuthorization,
    listAgentDelegationAuthorizationsForMessage,
    listAgentDelegationGrants
  })
}
