import { describe, expect, it } from 'vitest'
import { placeProjectMapWindow } from './project-map-window-placement'

describe('placeProjectMapWindow beside open windows', () => {
  const viewport = { width: 1200, height: 900 }
  const size = { width: 400, height: 500 }
  const anchor = { x: 100, y: 100, width: 200, height: 60 }

  it('prefers covering a window to covering a node', () => {
    const node = { x: 314, y: 94, width: 200, height: 60 }
    const window = { x: 150, y: 300, width: 400, height: 500, window: true }
    expect(placeProjectMapWindow(anchor, size, viewport, [node, window])).toEqual({
      x: 100,
      y: 174
    })
  })

  it('steps off a window it would land on, so that window keeps a header to click', () => {
    const below = { x: 100, y: 174 }
    const node = { x: 314, y: 94, width: 200, height: 60 }
    const window = { ...below, width: 400, height: 500, window: true }
    const placed = placeProjectMapWindow(anchor, size, viewport, [node, window])
    expect(placed.y).toBeGreaterThan(below.y)
  })
})
