import { useCallback, useRef, useState } from 'react'
import type { ProjectMapAvoidRect } from './project-map-window-placement'

/** One node's window: `z` orders the stack, `avoid` is where the other windows sat when it opened. */
export type ProjectMapOpenWindow = { id: string; z: number; avoid: readonly ProjectMapAvoidRect[] }

/** The windows already on screen, in viewport coordinates, so a new one opens beside them. */
function openWindowRects(viewport: HTMLElement | null): ProjectMapAvoidRect[] {
  if (!viewport) {
    return []
  }
  const origin = viewport.getBoundingClientRect()
  return [...viewport.querySelectorAll('[data-project-map-node-window]')].map((element) => {
    const box = element.getBoundingClientRect()
    return {
      x: box.x - origin.x,
      y: box.y - origin.y,
      width: box.width,
      height: box.height,
      window: true
    }
  })
}

/**
 * Every node window the user opened: opening another node adds a window and leaves the rest,
 * which close only from their own close button. Selection is separate: it highlights, it does
 * not open or close anything.
 */
export function useProjectMapOpenWindows(
  viewport: HTMLElement | null,
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
) {
  const [windows, setWindows] = useState<readonly ProjectMapOpenWindow[]>([])
  const nextZ = useRef(1)
  const raise = useCallback((id: string) => {
    const z = nextZ.current++
    setWindows((current) => {
      const top = Math.max(0, ...current.map((entry) => entry.z))
      const target = current.find((entry) => entry.id === id)
      return !target || target.z === top
        ? current
        : current.map((entry) => (entry.id === id ? { ...entry, z } : entry))
    })
  }, [])
  const open = useCallback(
    (id: string) => {
      setSelectedId(id)
      const avoid = openWindowRects(viewport)
      const z = nextZ.current++
      setWindows((current) =>
        current.some((entry) => entry.id === id)
          ? current.map((entry) => (entry.id === id ? { ...entry, z } : entry))
          : [...current, { id, z, avoid }]
      )
    },
    [setSelectedId, viewport]
  )
  const close = useCallback(
    (id: string) => {
      setWindows((current) => current.filter((entry) => entry.id !== id))
      setSelectedId((selected) => (selected === id ? null : selected))
    },
    [setSelectedId]
  )
  /**
   * Forgets windows whose node left the map (its tab closed, the project switched), so a chat that
   * comes back does not reopen one.
   */
  const keepShown = (shown: (id: string) => boolean): void => {
    if (windows.some((entry) => !shown(entry.id))) {
      setWindows(windows.filter((entry) => shown(entry.id)))
    }
  }
  return { windows, open, close, raise, keepShown, select: setSelectedId }
}

export type ProjectMapOpenWindows = ReturnType<typeof useProjectMapOpenWindows>
