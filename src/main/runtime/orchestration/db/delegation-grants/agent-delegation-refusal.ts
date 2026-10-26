import type Database from '../../../../sqlite/sync-database'
import { AGENT_DELEGATION_UNAUTHORIZED_CODE } from '../../../../../shared/agent-delegation-grant'
import { OrchestrationError } from '../../orchestration-error'

export function unauthorized(message: string, data: Record<string, unknown>): OrchestrationError {
  return new OrchestrationError(
    AGENT_DELEGATION_UNAUTHORIZED_CODE,
    `${message} Only the user authorizes agents, with an assignment card in a message they send to this conversation. Do the work yourself, or propose the arrangement to the user as an orca-orchestration card for them to send. No effects were applied.`,
    { effectsApplied: false, ...data }
  )
}

export function noConversation(what: string): OrchestrationError {
  return unauthorized(
    `This caller cannot ${what}: only an Orca chat or attested Orca terminal the user authorized can, and this caller proved neither.`,
    { reason: 'no_conversation' }
  )
}

export function recordSlotDispatch(
  db: Database.Database,
  slotId: string,
  dispatchId: string
): void {
  db.prepare(
    'INSERT INTO agent_delegation_slot_dispatches (dispatch_id, slot_id) VALUES (?, ?)'
  ).run(dispatchId, slotId)
}
