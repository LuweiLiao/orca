import { useCallback, useEffect, useRef, useState } from 'react'
import { PROJECT_MAP_NODE } from './project-map-layout'
import type { ProjectMapDropSlot } from './project-map-drop-slot'

/** A child chat being placed: dragged out of `originId`'s fork pin, then dropped on the canvas. */
export type ProjectMapForkDraft = {
  originId: string
  /** The ghost node's in-pin, snapped to the cell the child will occupy, in content coordinates. */
  point: { x: number; y: number }
  /** The lane row of that cell; the child is pinned there once created. */
  row: number
  /** Off the canvas or no free cell: letting go here creates nothing. */
  blocked: boolean
  /** Dropped; the fork panel is open for it. */
  placed: boolean
}

const DRAG_THRESHOLD = 4
// Long enough to cross the gap between a node and its handle without the handle vanishing.
const HOVER_GRACE_MS = 160

type Options = {
  contentPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
  snap: (originId: string, pointerY: number) => ProjectMapDropSlot | null
  onStart: (originId: string) => void
  onPlace: (originId: string) => void
}

function offCanvas(clientX: number, clientY: number): boolean {
  return !document.elementFromPoint(clientX, clientY)?.closest('[data-project-map-canvas]')
}

function slotPin(slot: ProjectMapDropSlot | null): { x: number; y: number } | null {
  return slot ? { x: slot.x, y: slot.y + PROJECT_MAP_NODE.headerPinOffsetY } : null
}

/** Drag a node's + handle onto the canvas to place a new child chat there; a plain click still opens the panel. */
export function useProjectMapForkDrag({ contentPoint, snap, onStart, onPlace }: Options) {
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
        const pointer = contentPoint(next.clientX, next.clientY)
        const slot = pointer ? snap(originId, pointer.y) : null
        if (pointer) {
          setDraft({
            originId,
            point: slotPin(slot) ?? pointer,
            row: slot?.row ?? 0,
            blocked: !slot || offCanvas(next.clientX, next.clientY),
            placed: false
          })
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
        const pointer = next ? contentPoint(next.clientX, next.clientY) : null
        const slot = pointer ? snap(originId, pointer.y) : null
        const pin = slotPin(slot)
        if (!next || !slot || !pin || offCanvas(next.clientX, next.clientY)) {
          setDraft(null)
          return
        }
        setDraft({ originId, point: pin, row: slot.row, blocked: false, placed: true })
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
    [contentPoint, onPlace, onStart, snap]
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
