import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatRailItem } from './native-chat-message-rail-items'
import {
  NativeChatCapabilityList,
  type NativeChatCapabilityControls
} from './NativeChatCapabilityList'
import { useNativeChatOutsideNavigation } from './use-native-chat-outside-navigation'

const NO_SCROLL_ROOT = { current: null }

export function NativeChatConversationSidebar({
  messages,
  controls,
  items,
  activeId,
  pendingId,
  onSelect,
  onReveal,
  scrollRef = NO_SCROLL_ROOT
}: {
  scrollRef?: React.RefObject<HTMLDivElement | null>
  messages: readonly NativeChatMessage[]
  controls?: NativeChatCapabilityControls
  items: readonly NativeChatRailItem[]
  activeId: string | null
  pendingId: string | null
  onSelect: (item: NativeChatRailItem) => void
  onReveal: (messageId: string) => void
}) {
  useNativeChatOutsideNavigation({ scrollRef, items, onSelect })
  return (
    <aside
      aria-label={translate(
        'components.native-chat.conversationSidebar',
        'Skills, MCP and timeline'
      )}
      className="absolute inset-y-0 right-0 z-20 flex w-72 max-w-full flex-col border-l bg-background pt-16"
    >
      <div className="flex min-h-0 max-h-3/5 flex-col">
        <NativeChatCapabilityList messages={messages} controls={controls} onReveal={onReveal} />
      </div>
      <nav
        aria-label={translate('components.native-chat.messageTimeline', 'Message timeline')}
        className="flex min-h-0 flex-1 flex-col gap-2 p-3"
      >
        <div className="text-xs font-medium">
          {translate('components.native-chat.messageTimeline', 'Message timeline')} · {items.length}
        </div>
        <div className="scrollbar-sleek min-h-0 overflow-y-auto">
          {items.map((item, index) => (
            <Button
              key={item.id}
              variant={activeId === item.id ? 'secondary' : 'ghost'}
              size="sm"
              aria-current={activeId === item.id ? 'true' : undefined}
              aria-busy={pendingId === item.id}
              className="h-auto min-h-8 w-full justify-start"
              onClick={() => onSelect(item)}
            >
              <span className="shrink-0 text-xs text-muted-foreground">{index + 1}</span>
              <span className="line-clamp-2 min-w-0 whitespace-normal text-left text-xs">
                {item.text ||
                  translate('components.native-chat.railImageMessage', 'Image attachment')}
              </span>
            </Button>
          ))}
        </div>
      </nav>
    </aside>
  )
}
