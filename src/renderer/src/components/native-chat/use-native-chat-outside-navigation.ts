import { useContext, useEffect, useRef } from 'react'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import type { NativeChatRailItem } from './native-chat-message-rail-items'
import { NativeChatRewindContext } from './native-chat-rewind-context'
import { onNativeChatNavigation } from './native-chat-outside-navigation'

/**
 * Answers a surface outside the transcript that asks to show one of its messages, through the
 * rail's own jump; a rewind waits until the message is loaded, then asks as the row's button does.
 */
export function useNativeChatOutsideNavigation({
  scrollRef,
  items,
  onSelect
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  items: readonly NativeChatRailItem[]
  onSelect: (item: NativeChatRailItem) => void
}): void {
  const rewind = useContext(NativeChatRewindContext)
  // Optional: a rail drawn without the app's dialog (a test, a preview) still jumps.
  const confirm = useContext(ConfirmationDialogContext)
  // A rewind asked for a message still paging in, made once its row is loaded.
  const rewindTo = useRef<string | null>(null)
  const requestRewind = (id: string): void => {
    if (rewind && confirm && !rewind.disabledReason) {
      void rewind.request(id, confirm)
    }
  }
  const latest = useRef({ items, onSelect, requestRewind })
  useEffect(() => {
    latest.current = { items, onSelect, requestRewind }
  })

  useEffect(
    () =>
      onNativeChatNavigation((request) => {
        const transcript = scrollRef.current
        if (!transcript || !request.scope.contains(transcript)) {
          return
        }
        const item = latest.current.items.find((candidate) => candidate.id === request.messageId)
        if (!item) {
          return
        }
        latest.current.onSelect(item)
        rewindTo.current = null
        if (request.rewind && item.slotIndex !== null) {
          latest.current.requestRewind(item.id)
        } else if (request.rewind) {
          rewindTo.current = item.id
        }
      }),
    [scrollRef]
  )

  useEffect(() => {
    const id = rewindTo.current
    if (id && items.some((item) => item.id === id && item.slotIndex !== null)) {
      rewindTo.current = null
      latest.current.requestRewind(id)
    }
  })
}
