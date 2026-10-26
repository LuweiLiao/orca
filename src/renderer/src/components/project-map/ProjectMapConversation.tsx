import { useMemo } from 'react'
import { useAppStore } from '@/store'
import NativeChatView from '@/components/native-chat/NativeChatView'
import { AgentTerminalPreview } from '@/components/dashboard-popout/AgentTerminalPreview'
import { terminalPreviewUnavailableMessage } from '@/components/dashboard-popout/terminal-preview-unavailable-message'
import {
  structuredAgentSessionOwnerForTab,
  structuredAgentSessionTargetForHost
} from '@/runtime/structured-agent-session-owner'
import { translate } from '@/i18n/i18n'
import { isStructuredTab } from '../../../../shared/structured-agent-session-tab'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { Tab } from '../../../../shared/tab-types'

function findStructuredTab(
  tabs: readonly Tab[] | undefined,
  card: Pick<DashboardCard, 'tabId'>
): Tab | null {
  const tab = tabs?.find((candidate) => candidate.id === card.tabId)
  return tab && isStructuredTab(tab) && tab.agentSessionAgent ? tab : null
}

/**
 * The live conversation behind a map node: the structured chat itself when Orca hosts it, the
 * live terminal when the agent runs in a PTY, and the last known messages otherwise.
 */
export function ProjectMapConversation({ card }: { card: DashboardCard }): React.JSX.Element {
  const tab = useAppStore((state) =>
    findStructuredTab(state.unifiedTabsByWorktree[card.worktreeId], card)
  )
  const owner = useAppStore((state) => (tab ? structuredAgentSessionOwnerForTab(state, tab) : null))
  const target = useMemo(() => structuredAgentSessionTargetForHost(owner), [owner])

  if (tab?.agentSessionAgent && target) {
    return (
      <div className="relative flex min-h-0 flex-1">
        <NativeChatView
          mode="structured"
          tabId={tab.id}
          sessionId={tab.entityId}
          agent={tab.agentSessionAgent}
          isVisible
          isFocusedGroup
          target={target}
        />
      </div>
    )
  }
  if (card.ptyId) {
    return (
      <AgentTerminalPreview
        ptyId={card.ptyId}
        terminalInput={card.terminalInput ?? null}
        className="h-auto min-h-0 flex-1"
      />
    )
  }
  return <ProjectMapConversationSummary card={card} />
}

function ProjectMapConversationSummary({ card }: { card: DashboardCard }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3 text-sm scrollbar-sleek">
      {card.lastUserMessage || card.task ? (
        <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
          {card.lastUserMessage || card.task}
        </div>
      ) : null}
      {card.lastAgentMessage ? (
        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {card.lastAgentMessage}
        </div>
      ) : null}
      <p className="mt-auto text-xs text-muted-foreground">
        {card.hostKind === 'ssh'
          ? terminalPreviewUnavailableMessage({ hostKind: card.hostKind })
          : translate(
              'projectMap.window.summaryOnly',
              'This conversation is not running here. Open it to load the full history.'
            )}
      </p>
    </div>
  )
}
