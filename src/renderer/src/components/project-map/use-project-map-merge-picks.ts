import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { AGENT_SESSION_FORK_MAX_SOURCES } from '../../../../shared/agent-session-fork'
import type { ProjectMapGraph } from './project-map-graph'
import type { ProjectMapLayout } from './project-map-layout'
import { projectMapAgentForkable } from './project-map-window-subject'

/**
 * The chats Shift, ⌘ or Ctrl clicks picked to merge, in the order picked. A pick must be a chat
 * this map can fork, on the same host as the first: a merge reads every source on one host.
 */
export function useProjectMapMergePicks(graph: ProjectMapGraph, layout: ProjectMapLayout) {
  const [picks, setPicks] = useState<readonly string[]>([])
  // A chat that closed or left the canvas is dropped from the merge.
  const picked = picks.filter(
    (id) => layout.nodes.has(id) && projectMapAgentForkable(graph.agents.get(id))
  )
  const toggle = useCallback(
    (id: string, selected: string | null): void => {
      const agent = graph.agents.get(id)
      if (!projectMapAgentForkable(agent)) {
        toast.error(
          translate('projectMap.merge.cannotPick', 'This chat cannot be merged from the map.')
        )
        return
      }
      setPicks((current) => {
        const base =
          current.length > 0
            ? current
            : selected && selected !== id && projectMapAgentForkable(graph.agents.get(selected))
              ? [selected]
              : []
        if (base.includes(id)) {
          return base.filter((candidate) => candidate !== id)
        }
        const host = base[0] ? graph.agents.get(base[0])?.chat?.executionHostId : undefined
        if (host !== undefined && agent?.chat?.executionHostId !== host) {
          toast.error(
            translate(
              'projectMap.merge.otherHost',
              'Only chats on the same host can be merged; this one runs on another.'
            )
          )
          return base
        }
        if (base.length >= AGENT_SESSION_FORK_MAX_SOURCES) {
          toast.error(
            translate('projectMap.merge.tooMany', 'A merge takes at most {{count}} chats.', {
              count: AGENT_SESSION_FORK_MAX_SOURCES
            })
          )
          return base
        }
        return [...base, id]
      })
    },
    [graph.agents]
  )
  const clear = useCallback(() => setPicks([]), [])
  return { picked, toggle, clear }
}
