// Surfaces outside a chat's transcript (the project map's timeline) ask it to show or rewind
// to one of its messages; the transcript owns its scroll and rewind, so they ask, never act.

import { translate } from '@/i18n/i18n'

const NAVIGATE_EVENT = 'orca:native-chat-navigate'

export type NativeChatOutsideNavigation = {
  /** The element holding the chat that should answer, so another view of the same chat stays put. */
  scope: Element
  messageId: string
  /** Rewind to the message once it is shown, through the transcript's own confirmation. */
  rewind?: true
}

export function requestNativeChatNavigation(request: NativeChatOutsideNavigation): void {
  window.dispatchEvent(
    new CustomEvent<NativeChatOutsideNavigation>(NAVIGATE_EVENT, { detail: request })
  )
}

export function onNativeChatNavigation(
  listener: (request: NativeChatOutsideNavigation) => void
): () => void {
  const handle = (event: Event): void => {
    if (event instanceof CustomEvent && isNavigation(event.detail)) {
      listener(event.detail)
    }
  }
  window.addEventListener(NAVIGATE_EVENT, handle)
  return () => window.removeEventListener(NAVIGATE_EVENT, handle)
}

function isNavigation(value: unknown): value is NativeChatOutsideNavigation {
  return (
    typeof value === 'object' &&
    value !== null &&
    'scope' in value &&
    value.scope instanceof Element &&
    'messageId' in value &&
    typeof value.messageId === 'string'
  )
}

/** What a rewind would cost beyond this chat, for its confirmation; null when nothing else is touched. */
export type NativeChatRewindImpact = (rewind: {
  sessionId: string
  epoch: string
  sequence: number
}) => string | null

let rewindImpact: NativeChatRewindImpact | null = null

/** One surface at a time knows what forked from a chat: the project map, while it is open. */
export function provideNativeChatRewindImpact(impact: NativeChatRewindImpact | null): void {
  rewindImpact = impact
}

/** A rewind confirmation's text, with what the rewind costs beyond this chat when anything. */
export function nativeChatRewindDescription(
  sessionId: string,
  state: { epoch: string | null; items: readonly { itemId: string; sequence: number }[] },
  itemId: string
): string {
  const description = translate(
    'components.native-chat.rewind.confirmation',
    'Discard this message and everything after it? The message returns to the composer so you can edit and resend it. File changes on disk are kept.'
  )
  const target = state.items.find((item) => item.itemId === itemId)
  const impact =
    target && state.epoch
      ? rewindImpact?.({ sessionId, epoch: state.epoch, sequence: target.sequence })
      : null
  return impact ? `${description}\n\n${impact}` : description
}
