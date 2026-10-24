import type { NativeChatComposerDraftOwner } from './native-chat-composer-draft-storage'

let resolveOwner: ((scopeKey: string) => NativeChatComposerDraftOwner | undefined) | null = null

export function setNativeChatComposerDraftOwnerResolver(
  resolver: (scopeKey: string) => NativeChatComposerDraftOwner | undefined
): void {
  resolveOwner = resolver
}

export function resolveNativeChatComposerDraftOwner(
  scopeKey: string
): NativeChatComposerDraftOwner | undefined {
  return resolveOwner?.(scopeKey)
}

export function resetNativeChatComposerDraftOwnerForTests(): void {
  resolveOwner = null
}
