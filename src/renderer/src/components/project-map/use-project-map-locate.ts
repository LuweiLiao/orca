import { useCallback, useEffect, useState } from 'react'
import { PROJECT_MAP_NODE, type ProjectMapLayout } from './project-map-layout'
import type { useProjectMapViewport } from './use-project-map-viewport'

const MATCH_FLASH_MS = 1800

type Locate = {
  layout: ProjectMapLayout
  viewport: Pick<ReturnType<typeof useProjectMapViewport>, 'centerOn'>
  /** Where a node is drawn: itself, or the stack that hides it; null when it is gone. */
  shownAs: (id: string) => string | null
  select: (id: string) => void
}

/** Centers a node, selects it, and flags it briefly so the eye finds it. */
export function useProjectMapLocate({ layout, viewport, shownAs, select }: Locate) {
  const [match, setMatch] = useState<{ id: string; flash: number } | null>(null)
  useEffect(() => {
    if (!match) {
      return
    }
    const timer = window.setTimeout(() => setMatch(null), MATCH_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [match])
  const { centerOn } = viewport
  const locate = useCallback(
    (id: string) => {
      const shown = shownAs(id)
      const box = shown ? layout.nodes.get(shown) : undefined
      if (!shown || !box) {
        return
      }
      centerOn({
        x: box.x,
        y: box.y,
        width: box.width,
        height: PROJECT_MAP_NODE.height
      })
      select(shown)
      setMatch((current) => ({ id: shown, flash: (current?.flash ?? 0) + 1 }))
    },
    // shownAs is rebuilt every render and reads only layout and the collapsed view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [centerOn, layout, select]
  )
  return { locate, match }
}
