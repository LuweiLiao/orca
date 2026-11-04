import { useState } from 'react'
import { Ellipsis, PanelRightClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { AgentSessionChatSelection } from '../../../../shared/agent-session-chat-capabilities'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatRailItem } from './native-chat-message-rail-items'
import {
  NativeChatCapabilitySection,
  switchableNames,
  useNativeChatCapabilityGroups,
  type NativeChatCapabilityControls
} from './NativeChatCapabilityList'
import { NativeChatSidebarSection } from './NativeChatSidebarSection'
import { useNativeChatOutsideNavigation } from './use-native-chat-outside-navigation'

const NO_SCROLL_ROOT = { current: null }

function sidebarLabel(): string {
  return translate('components.native-chat.conversationSidebar', 'Skills, MCP and timeline')
}

export function NativeChatConversationSidebar({
  messages,
  controls,
  items,
  activeId,
  pendingId,
  onSelect,
  onReveal,
  onClose,
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
  onClose?: () => void
}) {
  useNativeChatOutsideNavigation({ scrollRef, items, onSelect })
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const groups = useNativeChatCapabilityGroups(messages, controls)
  const capabilities = controls?.capabilities
  const change = async (next: AgentSessionChatSelection) => {
    if (!controls || pending) {
      return
    }
    setPending(true)
    try {
      await controls.onChange(next)
    } finally {
      setPending(false)
    }
  }
  const needle = query.trim().toLowerCase()
  const timeline = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => needle.length === 0 || item.text.toLowerCase().includes(needle))
  return (
    <aside
      aria-label={sidebarLabel()}
      className="absolute inset-y-0 right-0 z-20 flex w-72 max-w-full flex-col border-l bg-background pt-8"
    >
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {translate('components.native-chat.capabilitiesTitle', 'Skill / MCP')}
        </span>
        {capabilities ? (
          <DropdownMenu modal={false}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={pending}
                    aria-label={translate(
                      'components.native-chat.capabilitiesMore',
                      'More actions'
                    )}
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {translate('components.native-chat.capabilitiesMore', 'More actions')}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => void change({ disabledSkills: [], disabledMcpServers: [] })}
              >
                {translate('components.native-chat.capabilitiesEnableAll', 'Enable all')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void change({
                    disabledSkills: switchableNames(groups.skills),
                    disabledMcpServers: switchableNames(groups.mcpServers)
                  })
                }
              >
                {translate('components.native-chat.capabilitiesDisableAll', 'Disable all')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onClose ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={sidebarLabel()}
                aria-expanded={true}
                onClick={onClose}
              >
                <PanelRightClose />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {translate('components.native-chat.conversationSidebarClose', 'Close sidebar')}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="px-3 pb-2">
        <Input
          className="h-7 text-xs"
          aria-label={translate(
            'components.native-chat.capabilitiesSearch',
            'Search skills and MCP'
          )}
          placeholder={translate(
            'components.native-chat.capabilitiesSearch',
            'Search skills and MCP'
          )}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto border-t">
        {capabilities ? null : (
          <p className="px-3 pt-2 text-2xs text-muted-foreground">
            {translate(
              'components.native-chat.capabilitiesReadOnly',
              'This host or provider reports usage only.'
            )}
          </p>
        )}
        <NativeChatCapabilitySection
          title={translate('components.native-chat.capabilitiesSkills', 'Skill')}
          selectionKey="disabledSkills"
          rows={groups.skills}
          query={query}
          controls={controls}
          pending={pending}
          onChange={(next) => void change(next)}
          onReveal={onReveal}
        />
        <NativeChatCapabilitySection
          title={translate('components.native-chat.capabilitiesMcp', 'MCP')}
          selectionKey="disabledMcpServers"
          rows={groups.mcpServers}
          query={query}
          controls={controls}
          pending={pending}
          onChange={(next) => void change(next)}
          onReveal={onReveal}
        />
        <NativeChatSidebarSection
          title={translate('components.native-chat.messageTimeline', 'Message timeline')}
          count={`${items.length}`}
        >
          <nav
            aria-label={translate('components.native-chat.messageTimeline', 'Message timeline')}
            className="px-1.5 pb-2"
          >
            {timeline.map(({ item, index }) => (
              <button
                key={item.id}
                type="button"
                aria-current={activeId === item.id ? 'true' : undefined}
                aria-busy={pendingId === item.id}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  activeId === item.id && 'bg-accent'
                )}
                onClick={() => onSelect(item)}
              >
                <span className="w-5 shrink-0 text-right text-2xs leading-4.5 text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="line-clamp-2 min-w-0 flex-1">
                  {item.text ||
                    translate('components.native-chat.railImageMessage', 'Image attachment')}
                </span>
              </button>
            ))}
          </nav>
        </NativeChatSidebarSection>
      </div>
      {capabilities ? (
        <p className="border-t px-3 py-2 text-2xs text-muted-foreground">
          {translate(
            'components.native-chat.capabilitiesNextTurn',
            'Changes apply to the next message. Tool changes may refresh the prompt cache.'
          )}
        </p>
      ) : null}
    </aside>
  )
}
