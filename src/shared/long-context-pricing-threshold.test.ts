import { describe, expect, it } from 'vitest'
import {
  longContextPricingStage,
  longContextPricingThresholdTokens
} from './long-context-pricing-threshold'

describe('longContextPricingThresholdTokens', () => {
  it('reads the tier from the model pricing tables', () => {
    expect(longContextPricingThresholdTokens('gpt-5.5')).toBe(272_000)
    expect(longContextPricingThresholdTokens('gpt-5.5-high')).toBe(272_000)
    expect(longContextPricingThresholdTokens('claude-sonnet-4-5-20250929')).toBe(200_000)
    expect(longContextPricingThresholdTokens('claude-haiku-5-5')).toBe(100_000)
  })

  it('has no tier for models without a premium or that cannot be identified', () => {
    expect(longContextPricingThresholdTokens('gpt-5.2-codex')).toBeNull()
    expect(longContextPricingThresholdTokens('claude-sonnet-5')).toBeNull()
    expect(longContextPricingThresholdTokens('sonnet')).toBeNull()
    expect(longContextPricingThresholdTokens(null)).toBeNull()
  })
})

describe('longContextPricingStage', () => {
  it('warns from 90% of the tier and flags requests past it', () => {
    expect(longContextPricingStage(244_799, 272_000)).toBeNull()
    expect(longContextPricingStage(244_800, 272_000)).toBe('approaching')
    expect(longContextPricingStage(272_000, 272_000)).toBe('approaching')
    expect(longContextPricingStage(272_001, 272_000)).toBe('over')
    expect(longContextPricingStage(500_000, null)).toBeNull()
  })
})
