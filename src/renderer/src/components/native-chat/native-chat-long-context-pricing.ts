import { useMemo } from 'react'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import {
  longContextPricingStage,
  longContextPricingThresholdTokens,
  type LongContextPricingStage
} from '../../../../shared/long-context-pricing-threshold'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

export type NativeChatLongContextPricing = {
  thresholdTokens: number
  usedTokens: number
  stage: LongContextPricingStage | null
}

function currentModelId(snapshot: readonly SessionOptionDescriptor[]): string | null {
  const model = snapshot.find((option) => option.category === 'model')
  return model?.kind.type === 'select' ? (model.kind.currentValue ?? null) : null
}

/** The chat's position against its model's long-context price tier; null when the model has none or is unknown. */
export function nativeChatLongContextPricing(
  transport: Pick<NativeChatStructuredComposerTransport, 'contextUsage' | 'optionSnapshot'>
): NativeChatLongContextPricing | null {
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
  transport: NativeChatStructuredComposerTransport | undefined
): NativeChatLongContextPricing | null {
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
