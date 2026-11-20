import { useState, type ReactNode } from 'react'
import { PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { translate } from '@/i18n/i18n'
import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import type { NativeChatCapabilityControls } from './NativeChatCapabilityList'
import type { NativeChatMessageRailState } from '../viewport/rail/use-native-chat-message-rail'
import type { NativeChatRailItem } from '../viewport/rail/native-chat-message-rail-items'
import { NativeChatConversationSidebar } from './NativeChatConversationSidebar'

/** The transcript beside its Skill/MCP and timeline sidebar; the rail draws only while it is closed. */
export function NativeChatConversationFrame({
  shown,
  controls,
  messages,
  rail,
  pendingId,
  onSelect,
  onReveal,
  children
}: {
  shown: boolean
  controls?: NativeChatCapabilityControls
  messages: readonly NativeChatMessage[]
  rail: NativeChatMessageRailState
  pendingId: string | null
  onSelect: (item: NativeChatRailItem) => void
  onReveal: (messageId: string) => void
  children: (sidebarOpen: boolean) => ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(controls !== undefined)
  const label = translate('components.native-chat.conversationSidebar', 'Skills, MCP and timeline')
  if (!shown) {
    return <>{children(false)}</>
  }
  return (
    <div
      data-native-chat-sidebar-open={open}
      className="@container/chat relative flex min-h-0 flex-1 flex-col"
    >
      <div
        className={cn('relative flex min-h-0 flex-1 flex-col', open && '@min-[48rem]/chat:pr-72')}
      >
        {open ? null : (
          <div className="absolute top-8 right-2 z-30">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="chat-tool"
                  size="icon-xs"
                  aria-label={label}
                  aria-expanded={false}
                  onClick={() => setOpen(true)}
                >
                  <PanelRight />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={4}>
                {label}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        {children(open)}
        {open ? (
          <NativeChatConversationSidebar
            messages={messages}
            controls={controls}
            items={rail.items}
            activeId={rail.activeId}
            pendingId={pendingId}
            onSelect={onSelect}
            onReveal={onReveal}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </div>
    </div>
  )
}
