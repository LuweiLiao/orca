import { useMemo } from 'react'
import type { SessionOptionDescriptor } from '../../../../../shared/native-chat/input/native-chat-session-options'
import {
  longContextPricingStage,
  longContextPricingThresholdTokens,
  type LongContextPricing
} from '../../../../../shared/agent-usage/pricing/long-context-pricing-threshold'
import type { NativeChatStructuredComposerTransport } from '../composer/submit/native-chat-structured-composer-transport'

function currentModelId(snapshot: readonly SessionOptionDescriptor[]): string | null {
  const model = snapshot.find((option) => option.category === 'model')
  return model?.kind.type === 'select' ? (model.kind.currentValue ?? null) : null
}

/** The chat's position against its model's long-context price tier; null when the model has none or is unknown. */
export function nativeChatLongContextPricing(
  transport: Pick<NativeChatStructuredComposerTransport, 'contextUsage' | 'optionSnapshot'>
): LongContextPricing | null {
  const usage = transport.contextUsage
  if (!usage) {
    return null
  }
  const thresholdTokens = longContextPricingThresholdTokens(
    currentModelId(transport.optionSnapshot)
  )
  if (thresholdTokens === null) {
    return null
  }
  return {
    thresholdTokens,
    usedTokens: usage.usedTokens,
    stage: longContextPricingStage(usage.usedTokens, thresholdTokens)
  }
}

export function useNativeChatLongContextPricing(
  transport:
    | Pick<NativeChatStructuredComposerTransport, 'contextUsage' | 'optionSnapshot'>
    | undefined
): LongContextPricing | null {
  const contextUsage = transport?.contextUsage
  const optionSnapshot = transport?.optionSnapshot
  return useMemo(
    () =>
      contextUsage && optionSnapshot
        ? nativeChatLongContextPricing({ contextUsage, optionSnapshot })
        : null,
    [contextUsage, optionSnapshot]
  )
}
