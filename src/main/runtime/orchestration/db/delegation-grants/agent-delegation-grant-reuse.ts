import type Database from '../../../../sqlite/sync-database'
import { noConversation, recordSlotDispatch, unauthorized } from './agent-delegation-refusal'

/**
 * A `--terminal` start: work for an agent that already exists, named by its handle and the exact
 * instance running there now (pane and process, or a chat's Orca session id).
 */
export type AgentDelegationReuse = {
  holderKey: string | null
  assignee: string
  instance: { paneKey: string; processIncarnation: string } | { orcaSessionId: string } | null
}

/**
 * Reuse takes no new slot only when the agent is the very one this holder's authorization started
 * in this Run. A reused handle, a restarted process or any other agent was not authorized here.
 */
export function claimAgentDelegationReuseInTransaction(
  db: Database.Database,
  reuse: AgentDelegationReuse,
  dispatch: { id: string; runId: string }
): void {
  if (!reuse.holderKey) {
    throw noConversation(`hand work to ${reuse.assignee}`)
  }
  const { instance } = reuse
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects one TEXT slot id and the authorized worker's TEXT identity columns.
  const authorized = db
    .prepare(
      `SELECT sd.slot_id, d.assignee_pane_key, d.process_incarnation, d.assignee_orca_session_id
       FROM agent_delegation_slot_dispatches sd
       JOIN agent_delegation_slots s ON s.id = sd.slot_id
       JOIN agent_delegation_grants g ON g.id = s.grant_id
       JOIN dispatch_contexts d ON d.id = sd.dispatch_id
       WHERE g.holder_key = ? AND g.run_id = ? AND d.assignee_handle = ?
       ORDER BY sd.created_at DESC, sd.rowid DESC`
    )
    .all(reuse.holderKey, dispatch.runId, reuse.assignee) as {
    slot_id: string
    assignee_pane_key: string | null
    process_incarnation: string | null
    assignee_orca_session_id: string | null
  }[]
  const same = authorized.find((row) =>
    !instance
      ? false
      : 'orcaSessionId' in instance
        ? row.assignee_orca_session_id === instance.orcaSessionId
        : row.assignee_pane_key === instance.paneKey &&
          row.process_incarnation === instance.processIncarnation
  )
  if (!same) {
    throw unauthorized(
      authorized.length > 0
        ? `${reuse.assignee} no longer runs the agent the user authorized this conversation to start, so it cannot be handed this task.`
        : `${reuse.assignee} is not a worker the user authorized this conversation to start in this Run, so it cannot be handed this task.`,
      { reason: 'reuse_unauthorized' }
    )
  }
  recordSlotDispatch(db, same.slot_id, dispatch.id)
}
