import type { AgentSessionReferenceLink } from '../../../../shared/agent-session-reference-link'
import type { ProjectMapAgent, ProjectMapEdge } from './project-map-graph'

/** One wire per source and target pair; a reference with no node on the map is only counted. */
export function addReferenceEdges(
  links: readonly AgentSessionReferenceLink[],
  agents: Map<string, ProjectMapAgent>,
  paneKeyBySession: ReadonlyMap<string, string>,
  edges: ProjectMapEdge[]
): void {
  const drawn = new Map<string, ProjectMapEdge>()
  for (const link of links) {
    const to = paneKeyBySession.get(link.targetSessionId)
    const target = to ? agents.get(to) : undefined
    if (!to || !target) {
      continue
    }
    const from = link.source ? paneKeyBySession.get(link.source.sessionId) : undefined
    const counted = target.referencesIn ?? { count: 0, external: 0 }
    target.referencesIn = {
      count: counted.count + 1,
      external: counted.external + (from && from !== to ? 0 : 1)
    }
    if (from && from !== to) {
      const edge = drawn.get(`${from}|${to}`) ?? { kind: 'reference' as const, from, to }
      if (!drawn.has(`${from}|${to}`)) {
        drawn.set(`${from}|${to}`, edge)
        edges.push(edge)
      }
      // The latest reference sent between the two decides how the wire reads.
      if (link.sourceMessageCount === null) {
        edge.live = true
      } else {
        delete edge.live
      }
    }
  }
}
