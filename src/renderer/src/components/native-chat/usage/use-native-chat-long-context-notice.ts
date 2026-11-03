import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { launchAgentInNewTabWithOutcome } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab'
import { structuredChatTabById } from '@/lib/agent-session/tab-identity/structured-chat-tab-index'
import { useAppStore } from '@/store'
import { captureNativeChatComposerFocusIntent } from '@/components/native-chat/composer/focus/native-chat-composer-focus-intent'
import type { LongContextPricingStage } from '../../../../../shared/agent-usage/pricing/long-context-pricing-threshold'
import { createNonSecureContextUuid } from '../../../../../shared/identifiers/non-secure-context-uuid'
import { isTuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent-config'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'
import { formatContextTokenCount } from '../../../../../shared/native-chat/native-chat-context-usage-summary'
import type { NativeChatComposerNotice } from '../composer/controls/native-chat-composer-notice'
import type { NativeChatStructuredComposerTransport } from '../composer/submit/native-chat-structured-composer-transport'
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
  const tab = structuredChatTabById(useAppStore.getState().unifiedTabsByWorktree, worktreeId, tabId)
  // The launch reports its own failure.
  launchAgentInNewTabWithOutcome({
    requestId: createNonSecureContextUuid(),
    focusIntent: captureNativeChatComposerFocusIntent(),
    requestedSurface: 'chat',
    agent,
    worktreeId,
    ...(tab?.executionHostId ? { selectedExecutionHostId: tab.executionHostId } : {}),
    ...(tab?.groupId ? { groupId: tab.groupId } : {})
  })
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

/** The pane's composer notices with the long-context warning appended when it shows. */
export function useNativeChatNoticesWithLongContext(
  notices: readonly NativeChatComposerNotice[],
  transport: NativeChatLongContextNoticeTransport | undefined,
  chat: { tabId: string | undefined; agent: string | undefined }
): readonly NativeChatComposerNotice[] {
  const notice = useNativeChatLongContextNotice({ transport, tabId: chat.tabId, agent: chat.agent })
  return useMemo(() => (notice ? [...notices, notice] : notices), [notices, notice])
}
