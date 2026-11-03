import { longContextThresholdTokens as claudeLongContextThreshold } from './claude-model-pricing'
import {
  LONG_CONTEXT_THRESHOLD_TOKENS as CODEX_LONG_CONTEXT_THRESHOLD,
  MODEL_PRICING as CODEX_MODEL_PRICING,
  normalizeModelForPricing as normalizeCodexModel
} from './codex-model-pricing'

/** Prompt size past which the model's API bills the whole request at long-context rates; null when it has none or is unknown. */
export function longContextPricingThresholdTokens(model: string | null): number | null {
  const codexKey = normalizeCodexModel(model)
  if (codexKey !== null) {
    return CODEX_MODEL_PRICING[codexKey]?.longContext ? CODEX_LONG_CONTEXT_THRESHOLD : null
  }
  return claudeLongContextThreshold(model)
}

/** Share of the threshold at which the chat starts warning. */
export const LONG_CONTEXT_APPROACHING_RATIO = 0.9

export type LongContextPricingStage = 'approaching' | 'over'

export function longContextPricingStage(
  usedTokens: number,
  thresholdTokens: number | null
): LongContextPricingStage | null {
  if (thresholdTokens === null || thresholdTokens <= 0) {
    return null
  }
  if (usedTokens > thresholdTokens) {
    return 'over'
  }
  return usedTokens >= thresholdTokens * LONG_CONTEXT_APPROACHING_RATIO ? 'approaching' : null
}
