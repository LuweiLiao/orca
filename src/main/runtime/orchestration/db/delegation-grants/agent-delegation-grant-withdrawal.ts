import type { OrchestrationDb } from '../orchestration-db'

/** Ties an authorization to its queued card so editing or withdrawing it revokes the grant. */
export function bindAgentDelegationAuthorizationMessage(
  this: OrchestrationDb,
  authorizationId: string,
  messageId: string
): void {
  this.db
    .prepare('UPDATE agent_delegation_grants SET source_message_id = ? WHERE authorization_id = ?')
    .run(messageId, authorizationId)
}

/** Unspent withdrawals restore the previous grant; spent ones preserve only existing retries. */
export function revokeAgentDelegationAuthorization(
  this: OrchestrationDb,
  authorizationId: string
): void {
  this.db.exec('BEGIN IMMEDIATE')
  try {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects the nullable TEXT successor shared by this authorization's cards.
    const source = this.db
      .prepare(
        'SELECT superseded_by FROM agent_delegation_grants WHERE authorization_id = ? LIMIT 1'
      )
      .get(authorizationId) as { superseded_by: string | null } | undefined
    if (source && source.superseded_by !== 'revoked') {
      const spent = this.db
        .prepare(
          `SELECT 1 FROM agent_delegation_slots s JOIN agent_delegation_grants g ON g.id = s.grant_id
           WHERE g.authorization_id = ? LIMIT 1`
        )
        .get(authorizationId)
      if (!spent) {
        // Removing an older queued card must leave its successor, not its predecessor, current.
        this.db
          .prepare('UPDATE agent_delegation_grants SET superseded_by = ? WHERE superseded_by = ?')
          .run(source.superseded_by, authorizationId)
      }
      // Keep the source key: replaying a withdrawn submission cannot mint another allowance.
      this.db
        .prepare(
          "UPDATE agent_delegation_grants SET superseded_by = 'revoked' WHERE authorization_id = ?"
        )
        .run(authorizationId)
    }
    this.db.exec('COMMIT')
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
}

/** An edit's replay keeps the grants its first attempt recorded. */
export function listAgentDelegationAuthorizationsForMessage(
  this: OrchestrationDb,
  holderKey: string,
  messageId: string,
  exceptSourceKey: string
): string[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects one TEXT column.
  const rows = this.db
    .prepare(
      `SELECT DISTINCT authorization_id FROM agent_delegation_grants
       WHERE holder_key = ? AND source_message_id = ? AND instr(source_key, ?) <> 1`
    )
    .all(holderKey, messageId, `${exceptSourceKey}#`) as { authorization_id: string }[]
  return rows.map((row) => row.authorization_id)
}
