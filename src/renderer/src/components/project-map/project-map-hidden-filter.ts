import type { ProjectMapAgent, ProjectMapEdge, ProjectMapWorkspace } from './project-map-graph'

/** What a node is remembered by when hidden: its chat, else (a terminal agent) its pane. */
export function projectMapHideKey(agent: Pick<ProjectMapAgent, 'chat' | 'card'>): string {
  return agent.chat?.sessionId ?? agent.card.paneKey
}

/**
 * Takes hidden nodes off the finished graph. Their children stay, as roots whose source is not
 * loaded. Returns the hide keys that matched a node here.
 */
export function applyProjectMapHidden(
  agents: Map<string, ProjectMapAgent>,
  workspaces: ReadonlyMap<string, ProjectMapWorkspace>,
  edges: ProjectMapEdge[],
  hidden: ReadonlySet<string>
): string[] {
  if (hidden.size === 0) {
    return []
  }
  const gone = [...agents.values()].filter((agent) => hidden.has(projectMapHideKey(agent)))
  const goneKeys = new Set(gone.map((agent) => agent.card.paneKey))
  for (const agent of gone) {
    for (const childKey of agent.childPaneKeys) {
      const child = agents.get(childKey)
      if (child && !goneKeys.has(childKey)) {
        child.parentPaneKey = null
        child.hasUnresolvedParent = true
        child.sourceHidden = true
      }
    }
    const parent = agent.parentPaneKey ? agents.get(agent.parentPaneKey) : undefined
    if (parent) {
      parent.childPaneKeys = parent.childPaneKeys.filter((key) => key !== agent.card.paneKey)
    }
    agents.delete(agent.card.paneKey)
  }
  for (const workspace of workspaces.values()) {
    workspace.agentPaneKeys = workspace.agentPaneKeys.filter((key) => !goneKeys.has(key))
  }
  for (let index = edges.length - 1; index >= 0; index--) {
    const edge = edges[index]!
    if (goneKeys.has(edge.from) || goneKeys.has(edge.to)) {
      edges.splice(index, 1)
    }
  }
  return gone.map(projectMapHideKey)
}
