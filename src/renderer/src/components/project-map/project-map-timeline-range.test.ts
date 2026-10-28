import { describe, expect, it } from 'vitest'
import {
  pickProjectMapTimelineTurn,
  projectMapTimelineRangeBounds
} from './project-map-timeline-range'

const order = ['t1', 't2', 't3', 't4']

describe('pickProjectMapTimelineTurn', () => {
  it('starts a range, stretches it either way, and pulls an end back in', () => {
    const one = pickProjectMapTimelineTurn(null, 't2', order)
    expect(one).toEqual({ fromItemId: 't2', toItemId: 't2' })
    const wide = pickProjectMapTimelineTurn(
      pickProjectMapTimelineTurn(one, 't4', order),
      't1',
      order
    )
    expect(wide).toEqual({ fromItemId: 't1', toItemId: 't4' })
    expect(pickProjectMapTimelineTurn(wide, 't4', order)).toEqual({
      fromItemId: 't1',
      toItemId: 't3'
    })
    expect(pickProjectMapTimelineTurn(wide, 't1', order)).toEqual({
      fromItemId: 't2',
      toItemId: 't4'
    })
    // A turn inside the range leaves it as it is.
    expect(pickProjectMapTimelineTurn(wide, 't3', order)).toBe(wide)
  })

  it('drops a one-turn range picked again, and restarts one whose turns are gone', () => {
    expect(pickProjectMapTimelineTurn({ fromItemId: 't2', toItemId: 't2' }, 't2', order)).toBeNull()
    expect(pickProjectMapTimelineTurn({ fromItemId: 'old', toItemId: 't2' }, 't3', order)).toEqual({
      fromItemId: 't3',
      toItemId: 't3'
    })
    expect(projectMapTimelineRangeBounds({ fromItemId: 't3', toItemId: 't1' }, order)).toBeNull()
  })
})
