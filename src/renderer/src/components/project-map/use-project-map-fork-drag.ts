import { useCallback, useEffect, useRef, useState } from 'react'

/** A child chat being placed: dragged out of `originId`'s fork pin, then dropped on the canvas. */
export type ProjectMapForkDraft = {
  originId: string
  /** The ghost node's in-pin, in unscaled content coordinates. */
  point: { x: number; y: number }
  /** Over another node or off the canvas: letting go here creates nothing. */
  blocked: boolean
  /** Dropped; the fork panel is open for it. */
  placed: boolean
}

const DRAG_THRESHOLD = 4
// Long enough to cross the gap between a node and its handle without the handle vanishing.
const HOVER_GRACE_MS = 160

type Options = {
  contentPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
  onStart: (originId: string) => void
  onPlace: (originId: string) => void
}

function blockedAt(clientX: number, clientY: number): boolean {
  const target = document.elementFromPoint(clientX, clientY)
  return (
    !target?.closest('[data-project-map-canvas]') ||
    Boolean(target.closest('[data-project-map-node]'))
  )
}

/** Drag a node's + handle onto the canvas to place a new child chat there; a plain click still opens the panel. */
export function useProjectMapForkDrag({ contentPoint, onStart, onPlace }: Options) {
  const [draft, setDraft] = useState<ProjectMapForkDraft | null>(null)
  // The handle being pressed or dragged stays mounted however the pointer moves.
  const [pressed, setPressed] = useState<string | null>(null)
  const draggedRef = useRef(false)
  const cancelRef = useRef<(() => void) | null>(null)

  const onHandlePointerDown = useCallback(
    (originId: string, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }
      event.stopPropagation()
      const handle = event.currentTarget
      const start = { x: event.clientX, y: event.clientY }
      draggedRef.current = false
      setPressed(originId)
      handle.setPointerCapture(event.pointerId)
      const move = (next: PointerEvent): void => {
        if (!draggedRef.current) {
          if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < DRAG_THRESHOLD) {
            return
          }
          draggedRef.current = true
          onStart(originId)
        }
        const point = contentPoint(next.clientX, next.clientY)
        if (point) {
          const blocked = blockedAt(next.clientX, next.clientY)
          setDraft({ originId, point, blocked, placed: false })
        }
      }
      const finish = (next: PointerEvent | null): void => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', cancel)
        cancelRef.current = null
        setPressed(null)
        if (!draggedRef.current) {
          return
        }
        const point = next ? contentPoint(next.clientX, next.clientY) : null
        if (!next || !point || blockedAt(next.clientX, next.clientY)) {
          setDraft(null)
          return
        }
        setDraft({ originId, point, blocked: false, placed: true })
        onPlace(originId)
      }
      const up = (next: PointerEvent): void => finish(next)
      const cancel = (): void => finish(null)
      cancelRef.current = () => {
        if (handle.hasPointerCapture(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId)
        }
        finish(null)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', cancel)
    },
    [contentPoint, onPlace, onStart]
  )

  const clearDraft = useCallback(() => setDraft(null), [])
  const dragging = draft !== null && !draft.placed
  useEffect(() => {
    if (!dragging) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelRef.current?.()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [dragging])

  return {
    draft,
    dragging,
    /** The handle whose press or drag is under way. */
    pressed: dragging ? draft.originId : pressed,
    onHandlePointerDown,
    /** True once after a drag, so the click the browser sends after it does not open the panel. */
    consumeDrag: () => {
      const dragged = draggedRef.current
      draggedRef.current = false
      return dragged
    },
    clearDraft
  }
}

/** The node under the pointer, kept a moment after it leaves so its + handle can be reached. */
export function useProjectMapHover() {
  const [hovered, setHovered] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  useEffect(() => clearTimer, [])
  const enter = useCallback((id: string) => {
    clearTimer()
    setHovered(id)
  }, [])
  const leave = useCallback(() => {
    clearTimer()
    timerRef.current = window.setTimeout(() => setHovered(null), HOVER_GRACE_MS)
  }, [])
  return { hovered, enter, leave }
}
