import { useCallback, useSyncExternalStore } from 'react'
import type { OrchestrationAgentSelection } from '../../../../shared/native-chat-orchestration-reference'
import { assignmentCardsInSubmittedText } from '../../../../shared/agent-delegation-grant'
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
 * The message a send carries: the person's words, plus the cards their composer showed for exactly
 * these words, as pills the agent and the host both read. Cards the composer already holds win.
 */
export function withNativeChatTextDelegation(
  scopeKey: string,
  typed: string,
  message: { text: string; cards: readonly OrchestrationAgentSelection[] }
): { text: string; cards: readonly OrchestrationAgentSelection[] } {
  const shown = shownByScope.get(scopeKey)
  if (message.cards.length > 0 || !shown || shown.typed !== typed || shown.cards.length === 0) {
    return message
  }
  const tokens = shown.cards
    .map((card) => nativeChatOrchestrationAttributes(card).token)
    .join(nativeChatOrchestrationSeparator())
  const text = `${message.text.trimEnd()}\n\n${tokens}`
  // A token the host would not find (an unclosed code fence before it) must not ride along unread.
  return assignmentCardsInSubmittedText(text).length === shown.cards.length
    ? { text, cards: shown.cards }
    : message
}
