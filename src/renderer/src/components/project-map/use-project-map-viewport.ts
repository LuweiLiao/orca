import { useCallback, useEffect, useRef, useState } from 'react'

export type ProjectMapView = { x: number; y: number; zoom: number }

const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.6
const FIT_PADDING = 24

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/** Pan and zoom for the map canvas: drag the background to pan, wheel pans, Ctrl/⌘+wheel zooms. */
export function useProjectMapViewport(content: { width: number; height: number } | null) {
  // Callback ref: the page swaps the empty state for the canvas, so the observed element can change.
  const [element, viewportRef] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<ProjectMapView>({ x: 0, y: 0, zoom: 1 })
  const draggedRef = useRef(false)
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    if (!element) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  const fit = useCallback(() => {
    if (!content || size.width === 0) {
      return
    }
    const zoom = clampZoom(
      Math.min(
        1,
        (size.width - FIT_PADDING * 2) / content.width,
        (size.height - FIT_PADDING * 2) / content.height
      )
    )
    setView({ x: FIT_PADDING, y: FIT_PADDING, zoom })
  }, [content, size.height, size.width])

  const zoomBy = useCallback(
    (factor: number, origin?: { x: number; y: number }) => {
      setView((current) => {
        const zoom = clampZoom(current.zoom * factor)
        const anchor = origin ?? { x: size.width / 2, y: size.height / 2 }
        // Keep the point under the cursor fixed while the scale changes.
        const scale = zoom / current.zoom
        return {
          zoom,
          x: anchor.x - (anchor.x - current.x) * scale,
          y: anchor.y - (anchor.y - current.y) * scale
        }
      })
    },
    [size.height, size.width]
  )

  // Wheel listeners must be non-passive to stop the page from scrolling under the canvas.
  useEffect(() => {
    if (!element) {
      return
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.defaultPrevented) {
        return
      }
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect()
        zoomBy(Math.exp(-event.deltaY * 0.0025), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        })
        return
      }
      setView((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY
      }))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [element, zoomBy])

  const onBackgroundPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    const element = event.currentTarget
    const start = { x: event.clientX, y: event.clientY }
    draggedRef.current = false
    const origin = viewRef.current
    element.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent): void => {
      const dx = next.clientX - start.x
      const dy = next.clientY - start.y
      if (!draggedRef.current && Math.hypot(dx, dy) < 4) {
        return
      }
      draggedRef.current = true
      setView({ ...origin, x: origin.x + dx, y: origin.y + dy })
    }
    const end = (): void => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', end)
      element.removeEventListener('pointercancel', end)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', end)
    element.addEventListener('pointercancel', end)
  }, [])

  return {
    viewportRef,
    size,
    view,
    fit,
    zoomBy,
    onBackgroundPointerDown,
    /** True when the last background press was a pan, so its click must not clear selection. */
    consumeDrag: () => {
      const dragged = draggedRef.current
      draggedRef.current = false
      return dragged
    }
  }
}
