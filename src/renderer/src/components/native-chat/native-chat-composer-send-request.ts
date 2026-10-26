import { useCallback, useSyncExternalStore } from 'react'

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
