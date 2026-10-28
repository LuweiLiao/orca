import { useEffect, useState } from 'react'
import type { ProjectMapGraph } from './project-map-graph'

const AWAIT_FORKED_CHAT_MS = 30_000

/**
 * A new child shows up on a later snapshot; it is selected then, by its chat's session. Waited
 * for only on the project it was made from, and not forever: a child that lands elsewhere, or
 * never shows, must not grab the selection later.
 */
export function useProjectMapAwaitedChild(
  graph: ProjectMapGraph,
  shown: (paneKey: string) => boolean,
  select: (paneKey: string) => void
): (sessionId: string) => void {
  const [awaited, setAwaited] = useState<{ sessionId: string; projectId: string } | null>(null)
  const awaitedSession = awaited?.projectId === graph.projectId ? awaited.sessionId : null
  useEffect(() => {
    if (!awaited) {
      return
    }
    const timer = window.setTimeout(() => setAwaited(null), AWAIT_FORKED_CHAT_MS)
    return () => window.clearTimeout(timer)
  }, [awaited])
  // Adjusted during render, not in an effect, so the new node never draws unselected first.
  const arrived = awaitedSession
    ? [...graph.agents.values()].find((agent) => agent.chat?.sessionId === awaitedSession)
    : undefined
  if (arrived && shown(arrived.card.paneKey)) {
    select(arrived.card.paneKey)
    setAwaited(null)
  }
  return (sessionId) => setAwaited({ sessionId, projectId: graph.projectId })
}

/** Escape on the canvas, outside its windows, drops the selection and the merge picks. */
export function useProjectMapEscape(active: boolean, clear: () => void): void {
  useEffect(() => {
    if (!active) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !(event.target instanceof Element && event.target.closest('[data-project-map-window]'))
      ) {
        clear()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, clear])
}
