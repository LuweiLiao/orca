import type { OrchestrationDb } from '../orchestration-db'
import { ORCHESTRATION_DELIVERY_BATCH_LIMIT } from './mailbox-routing-page'

export type PointedUnreadMessage = { id: string; to_handle: string; age_seconds: number }

/** Mail a pointer announced at least `olderThanSeconds` ago that nobody has read; heartbeats are liveness, not mail. */
export function getPointedUnreadMessages(
  this: OrchestrationDb,
  olderThanSeconds: number,
  limit = ORCHESTRATION_DELIVERY_BATCH_LIMIT
): PointedUnreadMessage[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the static SELECT aliases are exactly PointedUnreadMessage's fields.
  return this.db
    .prepare(
      `SELECT id, to_handle,
              CAST((julianday('now') - julianday(delivered_at)) * 86400 AS INTEGER) AS age_seconds
       FROM messages
       WHERE read = 0 AND delivery_contract = 'current_delivery'
         AND delivered_at IS NOT NULL AND delivered_at <= datetime('now', ?)
         AND pointer_enter_pending = 0 AND type != 'heartbeat'
       ORDER BY sequence ASC LIMIT ?`
    )
    .all(`-${olderThanSeconds} seconds`, limit) as PointedUnreadMessage[]
}

export type PointedUnreadMessageMethods = {
  getPointedUnreadMessages: typeof getPointedUnreadMessages
}

export function attachPointedUnreadMessages(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, { getPointedUnreadMessages })
}
