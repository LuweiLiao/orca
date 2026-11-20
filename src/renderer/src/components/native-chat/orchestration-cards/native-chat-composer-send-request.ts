import { useCallback, useEffect, useSyncExternalStore } from 'react'

// One person's action that fills an empty composer and sends it, such as adding proposed cards.
const requests = new Map<string, string>()
const listeners = new Map<string, Set<() => void>>()

function notify(scopeKey: string): void {
  for (const listener of listeners.get(scopeKey) ?? []) {
    listener()
  }
}

/** Asks the composer of `scopeKey` to send once its draft is exactly `text`. */
export function requestNativeChatComposerSend(scopeKey: string, text: string): void {
  requests.set(scopeKey, text)
  notify(scopeKey)
}

/** True for the one composer that takes the request; others of the scope then see none. */
export function consumeNativeChatComposerSendRequest(scopeKey: string): boolean {
  if (!requests.delete(scopeKey)) {
    return false
  }
  notify(scopeKey)
  return true
}

export function useNativeChatComposerSendRequest(scopeKey: string): string | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      let scoped = listeners.get(scopeKey)
      if (!scoped) {
        scoped = new Set()
        listeners.set(scopeKey, scoped)
      }
      scoped.add(listener)
      return () => {
        scoped.delete(listener)
      }
    },
    [scopeKey]
  )
  return useSyncExternalStore(subscribe, () => requests.get(scopeKey) ?? null)
}

/** Sends what a person's one action put in the empty composer, once the draft shows exactly that. */
export function useNativeChatComposerRequestedSend(args: {
  draftScopeKey: string
  draft: string
  /** Images or annotations the request did not put there: the draft is no longer just its text. */
  holdsExtra: boolean
  send: () => void
}): void {
  const { draftScopeKey, draft, holdsExtra, send } = args
  const sendRequest = useNativeChatComposerSendRequest(draftScopeKey)
  useEffect(() => {
    if (sendRequest === null || draft.trim() === '') {
      return
    }
    // Two composers of one chat both see the request; only the one that takes it sends.
    const taken = consumeNativeChatComposerSendRequest(draftScopeKey)
    if (taken && draft.trim() === sendRequest.trim() && !holdsExtra) {
      send()
    }
  }, [draft, draftScopeKey, holdsExtra, send, sendRequest])
}
