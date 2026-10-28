import { useCallback, useState } from 'react'
import { useProjectMapMergePicks } from './use-project-map-merge-picks'
import { projectMapAgentForkable } from './project-map-window-subject'
import type { ProjectMapGraph } from './project-map-graph'
import type { ProjectMapLayout } from './project-map-layout'

/**
 * The chats Shift, ⌘ or Ctrl clicks gather for batch actions. Any chat on the map joins, on any
 * host; the subset a merge can take also joins the merge picks, which keep their own limits.
 */
export function useProjectMapMultiSelect(graph: ProjectMapGraph, layout: ProjectMapLayout) {
  const merge = useProjectMapMergePicks(graph, layout)
  const [ids, setIds] = useState<readonly string[]>([])
  const batch = ids.filter((id) => layout.nodes.has(id) && graph.agents.has(id))
  const { toggle: toggleMerge, clear: clearMerge, picked: mergePicked } = merge
  const toggle = useCallback(
    (id: string, selected: string | null): void => {
      if (!graph.agents.has(id)) {
        toggleMerge(id, selected)
        return
      }
      setIds((current) => {
        const base =
          current.length > 0
            ? current
            : selected && selected !== id && graph.agents.has(selected)
              ? [selected]
              : []
        return base.includes(id) ? base.filter((candidate) => candidate !== id) : [...base, id]
      })
      // A chat a merge cannot take joins the batch quietly; the merge would only refuse it aloud.
      const agent = graph.agents.get(id)
      const firstHost = mergePicked[0]
        ? graph.agents.get(mergePicked[0])?.chat?.executionHostId
        : null
      if (
        projectMapAgentForkable(agent) &&
        (mergePicked.length === 0 ||
          mergePicked.includes(id) ||
          firstHost === agent?.chat?.executionHostId)
      ) {
        toggleMerge(id, selected)
      }
    },
    [graph.agents, mergePicked, toggleMerge]
  )
  const clear = useCallback(() => {
    setIds([])
    clearMerge()
  }, [clearMerge])
  return { picked: merge.picked, batch, toggle, clear }
}
