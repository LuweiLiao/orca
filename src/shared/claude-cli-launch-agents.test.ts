import { describe, expect, it } from 'vitest'
import { mergeCreateOptions } from './claude-cli-launch-agents'

describe('a create that names a launcher', () => {
  const saved = { model: 'opus', effort: 'high' }
  const replace = (picks: Readonly<Record<string, string>>) => ({ ...picks })

  it('keeps the saved selection when the launcher is its only option', () => {
    expect(mergeCreateOptions('claude', { launcher: 'ccb' }, saved, replace)).toEqual({
      ...saved,
      launcher: 'ccb'
    })
  })

  it('lets the user’s picks replace the selection as before', () => {
    expect(
      mergeCreateOptions('claude', { launcher: 'ccb', model: 'sonnet' }, saved, replace)
    ).toEqual({ model: 'sonnet', launcher: 'ccb' })
  })

  it('treats an unknown launcher as a pick the provider can refuse', () => {
    expect(mergeCreateOptions('claude', { launcher: 'other' }, saved, replace)).toEqual({
      launcher: 'other'
    })
  })
})
