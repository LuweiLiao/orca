import { describe, expect, it } from 'vitest'
import { growthRevealShift } from './growth-tree-reveal'
import { projectMapSpanView } from './use-project-map-viewport'

const size = { width: 800, height: 600 }
const view = { x: 0, y: 0, zoom: 1 }

describe('growthRevealShift', () => {
  it('leaves the view alone when the chat is already inside it', () => {
    expect(growthRevealShift({ x: 100, y: 100, width: 80, height: 22 }, view, size)).toEqual({
      dx: 0,
      dy: 0
    })
  })

  it('moves by the least that brings a chat hidden at the right edge back in', () => {
    const shift = growthRevealShift({ x: 760, y: 100, width: 80, height: 22 }, view, size)
    expect(shift).toEqual({ dx: 800 - 24 - 840, dy: 0 })
  })

  it('moves only the axis that needs it, and honors the zoom and pan', () => {
    const panned = { x: -500, y: 0, zoom: 0.5 }
    expect(growthRevealShift({ x: 100, y: 1_400, width: 80, height: 22 }, panned, size)).toEqual({
      dx: 24 - (100 * 0.5 - 500),
      dy: 600 - 24 - (1_400 + 22) * 0.5
    })
  })

  it('lines a chat wider than the viewport up on its left edge', () => {
    expect(growthRevealShift({ x: 50, y: 10, width: 2_000, height: 22 }, view, size).dx).toBe(
      24 - 50
    )
  })
})

describe('projectMapSpanView', () => {
  const span = { x: 0, width: 4_000 }

  it('keeps a long span readable and shows its right end when anchored there', () => {
    const view = projectMapSpanView({ width: 1_000 }, span, {
      minZoom: 0.8,
      anchor: 'end',
      endPadding: 120
    })
    expect(view.zoom).toBe(0.8)
    // The end of the span, with its padding, sits at the right edge of the viewport.
    expect((span.x + span.width + 120) * view.zoom + view.x).toBeCloseTo(1_000 - 24, 6)
  })

  it('fits a short span whole, and never zooms in past 1', () => {
    expect(projectMapSpanView({ width: 1_000 }, { x: 0, width: 400 }, { minZoom: 0.8 }).zoom).toBe(
      1
    )
    expect(projectMapSpanView({ width: 1_000 }, { x: 100, width: 400 }).x).toBe(24 - 100)
  })

  it('shrinks to the viewport floor only when no minimum is asked for', () => {
    expect(projectMapSpanView({ width: 1_000 }, span).zoom).toBe(0.35)
  })
})
