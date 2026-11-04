import { useState, type ReactNode, type RefObject } from 'react'
import { PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatCapabilityControls } from './NativeChatCapabilityList'
import type { NativeChatMessageRailState } from './use-native-chat-message-rail'
import type { NativeChatRailItem } from './native-chat-message-rail-items'
import { NativeChatConversationSidebar } from './NativeChatConversationSidebar'
import { NativeChatMessageRail } from './NativeChatMessageRail'

export function NativeChatConversationFrame({
  controls,
  messages,
  rail,
  scrollRef,
  pendingId,
  onSelect,
  onReaderScroll,
  onReveal,
  children
}: {
  controls?: NativeChatCapabilityControls
  messages: readonly NativeChatMessage[]
  rail: NativeChatMessageRailState
  scrollRef: RefObject<HTMLDivElement | null>
  pendingId: string | null
  onSelect: (item: NativeChatRailItem) => void
  onReaderScroll: (deltaY: number) => void
  onReveal: (messageId: string) => void
  children: (sidebarOpen: boolean) => ReactNode
}) {
  const [open, setOpen] = useState(controls !== undefined)
  return (
    <div data-native-chat-sidebar-open={open} className="@container/chat relative min-h-0 flex-1">
      <div className={`relative h-full ${open ? '@min-[48rem]/chat:pr-72' : ''}`}>
        <div className="absolute top-8 right-2 z-30">
          <Button
            variant="ghost"
            size="xs"
            aria-label={translate(
              'components.native-chat.conversationSidebar',
              'Skills, MCP and timeline'
            )}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <PanelRight />
            {translate('components.native-chat.capabilitiesTitle', 'Skill / MCP')}
          </Button>
        </div>
        {children(open)}
        {open ? (
          <NativeChatConversationSidebar
            scrollRef={scrollRef}
            messages={messages}
            controls={controls}
            items={rail.items}
            activeId={rail.activeId}
            pendingId={pendingId}
            onSelect={onSelect}
            onReveal={onReveal}
          />
        ) : (
          <NativeChatMessageRail
            rail={rail}
            scrollRef={scrollRef}
            onSelect={onSelect}
            onReaderScroll={onReaderScroll}
            pendingId={pendingId}
          />
        )}
      </div>
    </div>
  )
}
