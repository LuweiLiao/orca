import type Database from '../../../../sqlite/sync-database'
import type { OrchestrationDb } from '../orchestration-db'

/**
 * Activates the holder's authorizations whose message has now reached its agent, then leaves only
 * the newest active one current: a person's later cards replace earlier ones once the agent has
 * them, never while they are still queued. Runs inside the caller's write transaction.
 */
export function activateDeliveredAgentDelegationsInTransaction(
  db: Database.Database,
  holderKey: string,
  deliveredMessageIds: ReadonlySet<string>
): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects two TEXT columns.
  const pending = db
    .prepare(
      `SELECT DISTINCT authorization_id, source_message_id FROM agent_delegation_grants
       WHERE holder_key = ? AND awaiting_delivery = 1 AND superseded_by IS NULL
         AND source_message_id IS NOT NULL`
    )
    .all(holderKey) as { authorization_id: string; source_message_id: string }[]
  activateAuthorizations(
    db,
    holderKey,
    pending
      .filter((row) => deliveredMessageIds.has(row.source_message_id))
      .map((row) => row.authorization_id)
  )
}

function activateAuthorizations(
  db: Database.Database,
  holderKey: string,
  authorizationIds: readonly string[]
): void {
  if (authorizationIds.length === 0) {
    return
  }
  const activate = db.prepare(
    `UPDATE agent_delegation_grants SET awaiting_delivery = 0
     WHERE authorization_id = ? AND superseded_by IS NULL`
  )
  for (const authorizationId of authorizationIds) {
    activate.run(authorizationId)
  }
  keepNewestAuthorizationCurrent(db, holderKey)
}

function keepNewestAuthorizationCurrent(db: Database.Database, holderKey: string): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects one TEXT column.
  const newest = db
    .prepare(
      `SELECT authorization_id FROM agent_delegation_grants
       WHERE holder_key = ? AND awaiting_delivery = 0 AND superseded_by IS NULL
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(holderKey) as { authorization_id: string } | undefined
  if (!newest) {
    return
  }
  db.prepare(
    `UPDATE agent_delegation_grants SET superseded_by = ?
     WHERE holder_key = ? AND awaiting_delivery = 0 AND superseded_by IS NULL
       AND authorization_id <> ?`
  ).run(newest.authorization_id, holderKey, newest.authorization_id)
}

/**
 * Settles cards recorded before their message was written to a terminal agent: delivered, they
 * authorize; not delivered, they are withdrawn as a refused chat message's are.
 */
export function settleAgentDelegationDelivery(
  this: OrchestrationDb,
  input: { holderKey: string; sourceKey: string; delivered: boolean }
): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects one TEXT column.
  const row = this.db
    .prepare(
      'SELECT authorization_id FROM agent_delegation_grants WHERE holder_key = ? AND source_key = ?'
    )
    .get(input.holderKey, `${input.sourceKey}#0`) as { authorization_id: string } | undefined
  if (!row) {
    return
  }
  if (!input.delivered) {
    this.revokeAgentDelegationAuthorization(row.authorization_id)
    return
  }
  this.db.exec('BEGIN IMMEDIATE')
  try {
    activateAuthorizations(this.db, input.holderKey, [row.authorization_id])
    this.db.exec('COMMIT')
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
}
