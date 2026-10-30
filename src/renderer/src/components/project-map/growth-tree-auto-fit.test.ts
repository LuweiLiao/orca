import { describe, expect, it } from 'vitest'
import { GROWTH_AUTO_FIT_FOLLOW_MS, shouldFollowGrowthAutoFit } from './growth-tree-auto-fit'

const fitted = { x: -2914, y: 24, zoom: 0.8 }
const base = {
  last: { view: fitted, at: 1_000, choice: 'compressed||' },
  view: fitted,
  now: 1_300,
  selected: false,
  replaying: false,
  choice: 'compressed||'
}

describe('shouldFollowGrowthAutoFit', () => {
  it('fits again when the tree grows right after an automatic fit nobody moved', () => {
    expect(shouldFollowGrowthAutoFit(base)).toBe(true)
  })

  it('keeps a view the person panned or zoomed', () => {
    expect(shouldFollowGrowthAutoFit({ ...base, view: { ...fitted, x: fitted.x - 40 } })).toBe(
      false
    )
    expect(shouldFollowGrowthAutoFit({ ...base, view: { ...fitted, zoom: 0.96 } })).toBe(false)
  })

  it('keeps the view when the person widened the tree by opening a fold or changing the scale', () => {
    expect(shouldFollowGrowthAutoFit({ ...base, choice: 'compressed||1792941037648' })).toBe(false)
    expect(shouldFollowGrowthAutoFit({ ...base, choice: 'linear||' })).toBe(false)
  })

  it('keeps the view while a chat is selected, so the detail panel never moves it', () => {
    expect(shouldFollowGrowthAutoFit({ ...base, selected: true })).toBe(false)
  })

  it('stops following once the tree has had time to settle', () => {
    expect(
      shouldFollowGrowthAutoFit({ ...base, now: base.last.at + GROWTH_AUTO_FIT_FOLLOW_MS + 1 })
    ).toBe(false)
  })

  it('never moves the view during a replay or before any automatic fit', () => {
    expect(shouldFollowGrowthAutoFit({ ...base, replaying: true })).toBe(false)
    expect(shouldFollowGrowthAutoFit({ ...base, last: null })).toBe(false)
  })
})
