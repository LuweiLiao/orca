import type { ProjectMapAgent, ProjectMapEdge, ProjectMapGraph } from './project-map-graph'
import type { ProjectMapWindowSubject } from './ProjectMapChatWindow'

/** A chat this renderer can fork: structured, on a host the map can reach by runtime RPC. */
export function projectMapAgentForkable(agent: ProjectMapAgent | undefined): boolean {
  return Boolean(
    agent?.chat?.executionHostId && agent.card.hostKind !== 'ssh' && agent.card.hostKind !== 'wsl'
  )
}

/** What the window beside a selected node shows: its chat, or a workspace and its chats. */
export function projectMapWindowSubject(
  graph: ProjectMapGraph,
  id: string | null
): ProjectMapWindowSubject | null {
  const agent = id ? graph.agents.get(id) : undefined
  if (agent) {
    return { kind: 'agent', agent }
  }
  const workspace = id ? graph.workspaces.get(id) : undefined
  return workspace
    ? {
        kind: 'workspace',
        workspace,
        agents: workspace.agentPaneKeys.flatMap((paneKey) => graph.agents.get(paneKey) ?? [])
      }
    : null
}

/** The nodes wired to the shown node, kept clear of its window and undimmed. */
export function projectMapLinkedNodes(
  edges: readonly ProjectMapEdge[],
  shown: string | null
): Set<string> {
  const ids = new Set<string>()
  for (const edge of edges) {
    if (edge.from === shown) {
      ids.add(edge.to)
    } else if (edge.to === shown) {
      ids.add(edge.from)
    }
  }
  return ids
}
