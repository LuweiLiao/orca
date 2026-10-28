import type { ProjectMapGraph } from './project-map-graph'
import { PROJECT_MAP_GRID, type ProjectMapLayout } from './project-map-layout'
import type { ProjectMapRowChanges } from './project-map-chat-rows'

export type ProjectMapRowDirection = 'up' | 'down'

type Peer = { paneKey: string; sessionId: string | null; row: number }

/** The chats sharing a node's lane and column, top to bottom, each with the row it is drawn on. */
function columnPeers(
  graph: ProjectMapGraph,
  layout: ProjectMapLayout,
  paneKey: string
): Peer[] | null {
  const box = layout.nodes.get(paneKey)
  const workspaceId = graph.agents.get(paneKey)?.card.worktreeId
  const lane = layout.lanes.find((candidate) => candidate.workspaceId === workspaceId)
  if (!box || box.kind !== 'agent' || !lane) {
    return null
  }
  const top = lane.y + PROJECT_MAP_GRID.laneInset
  return [...layout.nodes.values()]
    .filter((other) => other.kind === 'agent' && other.x === box.x)
    .flatMap((other) => {
      const agent = graph.agents.get(other.id)
      if (!agent || agent.card.worktreeId !== workspaceId) {
        return []
      }
      return [
        {
          paneKey: other.id,
          sessionId: agent.chat?.sessionId ?? null,
          row: Math.round((other.y - top) / PROJECT_MAP_GRID.row)
        }
      ]
    })
    .sort((a, b) => a.row - b.row)
}

/**
 * Swaps a chat with its neighbour above or below in the same lane and column, so wires keep
 * pointing right. The column is pinned as drawn so the rest of it cannot reflow; null when
 * there is no neighbour or either side has no chat session to remember a row under.
 */
export function projectMapRowMove(
  graph: ProjectMapGraph,
  layout: ProjectMapLayout,
  paneKey: string,
  direction: ProjectMapRowDirection
): ProjectMapRowChanges | null {
  const peers = columnPeers(graph, layout, paneKey)
  const index = peers?.findIndex((peer) => peer.paneKey === paneKey) ?? -1
  const other = peers?.[index + (direction === 'up' ? -1 : 1)]
  const moving = peers?.[index]
  if (!peers || !moving || !other || !moving.sessionId || !other.sessionId) {
    return null
  }
  const changes = new Map<string, number | null>()
  for (const peer of peers) {
    if (peer.sessionId) {
      changes.set(peer.sessionId, peer.row)
    }
  }
  changes.set(moving.sessionId, other.row)
  changes.set(other.sessionId, moving.row)
  return changes
}

/** Drops every hand-set row of this project's chats, which puts the lanes back in flow order. */
export function projectMapTidyRows(
  graph: ProjectMapGraph,
  pins: ReadonlyMap<string, number>
): ProjectMapRowChanges {
  const changes = new Map<string, number | null>()
  for (const agent of graph.agents.values()) {
    const sessionId = agent.chat?.sessionId
    if (sessionId && pins.has(sessionId)) {
      changes.set(sessionId, null)
    }
  }
  return changes
}
