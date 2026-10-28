import { useSyncExternalStore } from 'react'
import type { ProjectMapGraph } from './project-map-graph'
import { ProjectMapSummaryPanel } from './ProjectMapSummaryPanel'
import {
  openProjectMapSummary,
  projectMapSummaryState,
  subscribeToProjectMapSummaryState
} from './project-map-summary-state'

/** Shows the summary panel of the node the menu opened it for, while that node is on the map. */
export function ProjectMapSummaryHost({
  graph
}: {
  graph: ProjectMapGraph
}): React.JSX.Element | null {
  const { openPaneKey } = useSyncExternalStore(
    subscribeToProjectMapSummaryState,
    projectMapSummaryState
  )
  const agent = openPaneKey ? graph.agents.get(openPaneKey) : undefined
  return agent ? (
    <ProjectMapSummaryPanel
      key={agent.card.paneKey}
      agent={agent}
      onClose={() => openProjectMapSummary(null)}
    />
  ) : null
}
