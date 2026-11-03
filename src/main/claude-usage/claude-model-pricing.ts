import {
  addTokenTotals,
  minTokenTotals,
  NO_TOKENS,
  type ClaudeBillableTokens
} from './claude-billable-tokens'
import type { ClaudeUsageTokenTotals } from './types'
import {
  longContextThresholdTokens,
  MODEL_PRICING,
  normalizeModelForPricing,
  type ClaudeTokenRates
} from '../../shared/claude-model-pricing'

export { MODEL_PRICING, normalizeModelForPricing }

function priceTokens(rates: ClaudeTokenRates, tokens: ClaudeUsageTokenTotals): number {
  const write1hTokens = Math.min(Math.max(tokens.cacheWrite1hTokens, 0), tokens.cacheWriteTokens)
  return (
    tokens.inputTokens * rates.input +
    tokens.outputTokens * rates.output +
    tokens.cacheReadTokens * rates.cacheRead +
    (tokens.cacheWriteTokens - write1hTokens) * rates.cacheWrite +
    write1hTokens * rates.cacheWrite1h
  )
}

export function longContextTurnTokens(
  model: string | null,
  turn: ClaudeUsageTokenTotals
): ClaudeUsageTokenTotals | undefined {
  const threshold = longContextThresholdTokens(model)
  const prompt = turn.inputTokens + turn.cacheReadTokens + turn.cacheWriteTokens
  return threshold !== null && prompt > threshold ? addTokenTotals(NO_TOKENS, turn) : undefined
}

export function estimateCostUsd(model: string | null, tokens: ClaudeBillableTokens): number | null {
  const normalized = normalizeModelForPricing(model)
  if (!normalized) {
    return null
  }
  const pricing = MODEL_PRICING[normalized]
  if (!pricing.longContext || !tokens.longContext) {
    return priceTokens(pricing, tokens) / 1_000_000
  }
  const longTokens = minTokenTotals(tokens.longContext, tokens)
  return (
    (priceTokens(pricing, addTokenTotals(tokens, longTokens, -1)) +
      priceTokens(pricing.longContext, longTokens)) /
    1_000_000
  )
}
