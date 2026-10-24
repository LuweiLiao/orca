import {
  hasLocalChange,
  notifyScope,
  records,
  reconcileRestoredImageChecks
} from './native-chat-composer-draft-memory'
import {
  nativeChatComposerDraftStorage,
  parseStoredNativeChatComposerDraft
} from './native-chat-composer-draft-storage'

let channel: BroadcastChannel | null = null

function adoptForeignChange(message: unknown): void {
  const scopeKey =
    typeof message === 'object' && message !== null && 'scopeKey' in message
      ? message.scopeKey
      : null
  if (typeof scopeKey !== 'string' || hasLocalChange(scopeKey)) {
    return
  }
  void nativeChatComposerDraftStorage()
    .read(scopeKey)
    .then((value) => {
      if (hasLocalChange(scopeKey)) {
        return
      }
      const draft = parseStoredNativeChatComposerDraft(value)
      if (draft) {
        reconcileRestoredImageChecks(scopeKey, draft.images, records.get(scopeKey)?.images ?? [])
        records.set(scopeKey, draft)
      } else {
        records.delete(scopeKey)
        reconcileRestoredImageChecks(scopeKey, [])
      }
      notifyScope(scopeKey)
    })
    .catch(() => {})
}

export function installNativeChatComposerDraftBroadcast(): void {
  if (channel || typeof BroadcastChannel === 'undefined') {
    return
  }
  channel = new BroadcastChannel('orca-native-chat-composer-drafts')
  channel.onmessage = (event) => adoptForeignChange(event.data)
  // Node's test channel must not keep the process alive.
  if ('unref' in channel && typeof channel.unref === 'function') {
    channel.unref()
  }
}

export function broadcastNativeChatComposerDraftChange(scopeKey: string): void {
  channel?.postMessage({ scopeKey })
}

export function resetNativeChatComposerDraftBroadcastForTests(): void {
  channel?.close()
  channel = null
}
