import type { AgentJournalSnapshot } from '../../shared/agent-session-journal-types'
import type { AgentSessionForkCut } from '../../shared/agent-session-fork'

/**
 * A chat's journal through a recorded cut. Within the recorded epoch the sequence holds; after a
 * rewind or clear only the item itself can. Null when the chat no longer has that place.
 */
export function journalItemsThrough(
  snapshot: AgentJournalSnapshot,
  cut: Pick<AgentSessionForkCut, 'journalEpoch' | 'journalSequence' | 'journalItemId'>
): AgentJournalSnapshot['items'] | null {
  const through =
    cut.journalEpoch === snapshot.cursor.epoch
      ? cut.journalSequence
      : snapshot.items.find((item) => item.itemId === cut.journalItemId)?.sequence
  return through === undefined ? null : snapshot.items.filter((item) => item.sequence <= through)
}
