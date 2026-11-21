import { useCallback, useSyncExternalStore } from 'react'
import {
  assignmentCardsInSubmittedText,
  type OrchestrationAgentSelection
} from '../../../../../shared/native-chat-orchestration-reference'
import {
  nativeChatOrchestrationAttributes,
  nativeChatOrchestrationSeparator
} from './native-chat-orchestration-instruction'

/** The cards a composer shows for its draft, which a send of exactly that draft carries. */
type Shown = { owner: object; typed: string; cards: readonly OrchestrationAgentSelection[] }

const shownByScope = new Map<string, Shown>()
const dismissedByScope = new Map<string, string>()
const dismissalListeners = new Map<string, Set<() => void>>()

export function showNativeChatTextDelegation(scopeKey: string, shown: Shown): void {
  shownByScope.set(scopeKey, shown)
}

/** Forgets what `owner` showed, unless another composer of the scope has shown since. */
export function hideNativeChatTextDelegation(scopeKey: string, owner: object): void {
  if (shownByScope.get(scopeKey)?.owner === owner) {
    shownByScope.delete(scopeKey)
  }
}

function notifyDismissal(scopeKey: string): void {
  for (const listener of dismissalListeners.get(scopeKey) ?? []) {
    listener()
  }
}

export function dismissNativeChatTextDelegation(scopeKey: string, signature: string): void {
  dismissedByScope.set(scopeKey, signature)
  notifyDismissal(scopeKey)
}

/** A draft with no request forgets its dismissal, so the next request shows again. */
export function forgetNativeChatTextDelegationDismissal(scopeKey: string): void {
  if (dismissedByScope.delete(scopeKey)) {
    notifyDismissal(scopeKey)
  }
}

export function useNativeChatTextDelegationDismissal(scopeKey: string): string | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      let listeners = dismissalListeners.get(scopeKey)
      if (!listeners) {
        listeners = new Set()
        dismissalListeners.set(scopeKey, listeners)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    [scopeKey]
  )
  return useSyncExternalStore(subscribe, () => dismissedByScope.get(scopeKey) ?? null)
}

/**
 * The text a send carries: the person's words, plus the cards their composer showed for exactly
 * these words, as pills the agent reads. Cards the composer already holds win.
 */
export function withNativeChatTextDelegation(
  scopeKey: string,
  typed: string,
  message: { text: string; holdsCards: boolean }
): string {
  const shown = shownByScope.get(scopeKey)
  if (message.holdsCards || !shown || shown.typed !== typed || shown.cards.length === 0) {
    return message.text
  }
  const tokens = shown.cards
    .map((card) => nativeChatOrchestrationAttributes(card).token)
    .join(nativeChatOrchestrationSeparator())
  const text = `${message.text.trimEnd()}\n\n${tokens}`
  // A token inside an unclosed code fence would show as raw text, not as a card.
  return assignmentCardsInSubmittedText(text).length === shown.cards.length ? text : message.text
}
