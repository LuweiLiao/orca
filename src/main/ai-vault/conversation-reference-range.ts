import type { AgentJournalSnapshot } from '../../shared/agent-session-journal-types'
import type { ConversationReferenceRange } from '../../shared/conversation-reference'
import type { ConversationReferenceCut } from './conversation-reference-store'

/** A reference's cut narrowed to whole turns: it starts at one user message and stops at the end
 *  of another's turn, the turns between included. */
export type ConversationReferenceRangeCut = ConversationReferenceCut & { fromMessage: number }

/**
 * The cut for a range of turns, read against the source as it stands. Refuses a range whose
 * messages are gone or out of order, and one that ends in a turn still running.
 */
export function conversationReferenceRangeCut(
  snapshot: AgentJournalSnapshot,
  /** The source's sent messages, as a reference reads them. */
  messagesOf: (snapshot: AgentJournalSnapshot) => readonly { id: string; role: string }[],
  range: ConversationReferenceRange,
  /** The source is mid-turn; an older host may not say. */
  working: boolean | undefined
): ConversationReferenceRangeCut {
  if (range.epoch !== snapshot.cursor.epoch) {
    throw new Error('The source chat changed since those messages were read; pick them again.')
  }
  const said = messagesOf(snapshot)
  const from = said.findIndex(
    (message) => message.id === range.fromItemId && message.role === 'user'
  )
  const to = said.findIndex((message) => message.id === range.toItemId && message.role === 'user')
  if (from === -1 || to === -1) {
    throw new Error('Those messages are not in the source chat any more.')
  }
  if (to < from) {
    throw new Error('The range ends before it starts.')
  }
  // Through the end of the last turn: everything before the next message the person sent.
  const nextAsk = said.findIndex((message, index) => index > to && message.role === 'user')
  if (nextAsk === -1 && working) {
    throw new Error('The last turn of that range is still running; reference it once it ends.')
  }
  const lastMessage = said[(nextAsk === -1 ? said.length : nextAsk) - 1]
  const item = lastMessage
    ? snapshot.items.find((candidate) => candidate.itemId === lastMessage.id)
    : undefined
  if (!item) {
    throw new Error('Those messages are not in the source chat any more.')
  }
  return {
    journalItemId: item.itemId,
    journalEpoch: snapshot.cursor.epoch,
    journalSequence: item.sequence,
    messageCount: nextAsk === -1 ? said.length : nextAsk,
    fromMessage: from
  }
}
