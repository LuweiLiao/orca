/**
 * A pointer is one line in a long turn, and once stamped nothing points that mail again; a busy
 * agent can leave it unchecked for hours. Its own journal activity re-arms such mail, a bounded
 * number of times. A mailbox holding an unacked batch was already fetched from, so it is left alone.
 */

import type { OrchestrationDb } from './db'

/** Ages since the last pointer at which still-unread mail is pointed again; then it is left to `check`. */
const REMINDER_AGES_S = [10 * 60, 30 * 60] as const
const SWEEP_INTERVAL_MS = 60_000
const REMINDER_MEMORY = 1_000

export class StructuredStaleMailReminder {
  private readonly lastSweepAt = new Map<string, number>()
  /** Reminders already spent per message; in memory, so a restart may remind once more. */
  private readonly spent = new Map<string, number>()

  constructor(
    private readonly deps: {
      getDb: () => OrchestrationDb | null
      ownerSessionId: (mailboxHandle: string) => string | undefined
      /** Point the mailbox's undelivered mail now, as a new arrival would. */
      redeliver: (mailboxHandle: string) => void
      now?: () => number
    }
  ) {}

  sweep(sessionId: string): void {
    try {
      this.sweepOnce(sessionId)
    } catch (error) {
      // Best-effort: the mail itself stays readable through `check`.
      console.warn('[orchestration] stale mail reminder failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private sweepOnce(sessionId: string): void {
    const now = this.deps.now?.() ?? Date.now()
    if (now - (this.lastSweepAt.get(sessionId) ?? 0) < SWEEP_INTERVAL_MS) {
      return
    }
    this.lastSweepAt.delete(sessionId)
    this.lastSweepAt.set(sessionId, now)
    const db = this.deps.getDb()
    const stale = db?.getPointedUnreadMessages?.(REMINDER_AGES_S[0])
    if (!db || !stale?.length) {
      return
    }
    // Per mailbox: whether this session owns it and has no unacked batch there.
    const mailboxes = new Map<string, boolean>()
    const rearm = new Map<string, string[]>()
    for (const message of stale) {
      const spent = this.spent.get(message.id) ?? 0
      const dueAt = REMINDER_AGES_S[spent]
      if (dueAt === undefined || message.age_seconds < dueAt) {
        continue
      }
      let open = mailboxes.get(message.to_handle)
      if (open === undefined) {
        open =
          this.deps.ownerSessionId(message.to_handle) === sessionId &&
          !db.hasOutstandingMailboxDelivery?.(message.to_handle)
        mailboxes.set(message.to_handle, open)
      }
      if (!open) {
        continue
      }
      rearm.set(message.to_handle, [...(rearm.get(message.to_handle) ?? []), message.id])
      this.spent.set(message.id, spent + 1)
    }
    for (const [mailboxHandle, ids] of rearm) {
      db.markAsUndelivered(ids)
      this.deps.redeliver(mailboxHandle)
    }
    forgetOldest(this.spent)
    forgetOldest(this.lastSweepAt)
  }
}

function forgetOldest(entries: Map<string, number>): void {
  for (const key of entries.keys()) {
    if (entries.size <= REMINDER_MEMORY) {
      return
    }
    entries.delete(key)
  }
}
