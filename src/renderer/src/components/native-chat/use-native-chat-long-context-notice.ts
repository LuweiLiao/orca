import { useCallback, useEffect, useReducer, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { structuredChatTabById } from '@/lib/structured-chat-tab-index'
import { useAppStore } from '@/store'
import { captureNativeChatComposerFocusIntent } from '@/components/native-chat/use-native-chat-composer-reveal-focus'
import type { LongContextPricingStage } from '../../../../shared/long-context-pricing-threshold'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { NativeChatComposerNotice } from './native-chat-composer-notice'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import { formatContextTokenCount } from './native-chat-context-usage-summary'
import { useNativeChatLongContextPricing } from './native-chat-long-context-pricing'

/** The stage each chat's notice was dismissed at; survives the composer remounting. */
const dismissedStageBySession = new Map<string, LongContextPricingStage>()

function noticeText(
  stage: LongContextPricingStage,
  thresholdTokens: number,
  usedTokens: number
): string {
  const threshold = formatContextTokenCount(thresholdTokens)
  return stage === 'over'
    ? translate(
        'components.native-chat.longContextNotice.over',
        'Context is past {{threshold}} tokens, so each request is billed at long-context API rates. Compact it or start a new chat to bring the cost down.',
        { threshold }
      )
    : translate(
        'components.native-chat.longContextNotice.approaching',
        'Context is {{used}} tokens. Past {{threshold}}, each request is billed at long-context API rates.',
        { used: formatContextTokenCount(usedTokens), threshold }
      )
}

function launchNewChat(tabId: string, worktreeId: string, agent: TuiAgent): void {
  const focusIntent = captureNativeChatComposerFocusIntent()
  const tab = structuredChatTabById(useAppStore.getState().unifiedTabsByWorktree, worktreeId, tabId)
  const result = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    focusIntent,
    requestedSurface: 'chat',
    agent,
    worktreeId,
    ...(tab?.executionHostId ? { selectedExecutionHostId: tab.executionHostId } : {}),
    ...(tab?.groupId ? { groupId: tab.groupId } : {})
  })
  if (!result) {
    focusIntent.cancel()
    toast.error(
      translate(
        'auto.components.tab.bar.QuickLaunchButton.465e432ef1',
        'Could not build launch command for {{value0}}.',
        { value0: getAgentLabel(agent) }
      )
    )
  }
}

export type NativeChatLongContextNoticeTransport = Pick<
  NativeChatStructuredComposerTransport,
  | 'sessionId'
  | 'worktreeId'
  | 'contextUsage'
  | 'optionSnapshot'
  | 'conversationCommands'
  | 'dispatchCommand'
  | 'onError'
  | 'sendOut'
>

/** Warns when the chat nears or passes its model's long-context price tier, offering /compact and a new chat. */
export function useNativeChatLongContextNotice({
  transport,
  tabId,
  agent
}: {
  transport: NativeChatLongContextNoticeTransport | undefined
  tabId: string | undefined
  agent: string | undefined
}): NativeChatComposerNotice | null {
  const pricing = useNativeChatLongContextPricing(transport)
  const sessionId = transport?.sessionId ?? ''
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const [compacting, setCompacting] = useState(false)
  const stage = pricing?.stage ?? null
  const belowTier = pricing !== null && stage === null
  useEffect(() => {
    // Back under the tier (compacted or cleared): a later climb warns again.
    if (belowTier) {
      dismissedStageBySession.delete(sessionId)
    }
  }, [belowTier, sessionId])
  const dismissed = dismissedStageBySession.get(sessionId)
  const dismiss = useCallback(() => {
    if (stage) {
      dismissedStageBySession.set(sessionId, stage)
      rerender()
    }
  }, [sessionId, stage])
  const compact = useCallback(async () => {
    if (!transport) {
      return
    }
    setCompacting(true)
    try {
      const outcome = await transport.dispatchCommand('/compact')
      if (outcome.error) {
        transport.onError(outcome.error)
      }
    } finally {
      setCompacting(false)
    }
  }, [transport])

  if (!transport || !pricing || stage === null || dismissed === stage || dismissed === 'over') {
    return null
  }
  const canCompact = transport.conversationCommands?.includes('compact') === true
  const { worktreeId } = transport
  const newChat =
    tabId && worktreeId && isTuiAgent(agent)
      ? {
          label: translate('components.native-chat.longContextNotice.newChat', 'New chat'),
          onClick: () => launchNewChat(tabId, worktreeId, agent)
        }
      : undefined
  const compactAction = canCompact
    ? {
        label: translate('components.native-chat.longContextNotice.compact', 'Compact'),
        onClick: () => void compact(),
        disabled: compacting || transport.sendOut === true
      }
    : undefined
  return {
    key: 'long-context-pricing',
    kind: 'context',
    text: noticeText(stage, pricing.thresholdTokens, pricing.usedTokens),
    action: compactAction ?? newChat,
    ...(compactAction && newChat ? { secondaryAction: newChat } : {}),
    onDismiss: dismiss
  }
}
