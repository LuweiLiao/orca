import type { JournalReducerState } from './journal-reducer'
import { journalInputOrder } from './journal-input-order'

/** Replacement carries facts directly; restatement is not a new admission or introduction. */
export function copyJournalNativeState(
  previous: JournalReducerState,
  state: JournalReducerState
): void {
  for (const [id, own] of previous.inputEntries) {
    state.inputEntries.set(id, {
      ...own,
      context: { ...own.context, source: { ...own.context.source } }
    })
  }
  for (const [id, card] of previous.inputCards) {
    state.inputCards.set(id, {
      ...card,
      ...(card.baseline
        ? { baseline: { coordinate: card.baseline.coordinate && { ...card.baseline.coordinate } } }
        : {})
    })
  }
  journalInputOrder(state).lineage.restoreFrontier(state.lastSequence, state.inputEntries.values())
}
