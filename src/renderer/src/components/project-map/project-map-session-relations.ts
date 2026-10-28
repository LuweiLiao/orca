import { useEffect, useSyncExternalStore } from 'react'
import { translate } from '@/i18n/i18n'
import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import type { AgentSessionReferenceLink } from '../../../../shared/agent-session-reference-link'
import { provideNativeChatRewindImpact } from '@/components/native-chat/native-chat-outside-navigation'
import { projectMapForksPastRewind, type ProjectMapTimelineNode } from './project-map-timeline'
import type { ProjectMapGraph } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'

/** What the open map knows links chats: read by its timeline and by a chat's rewind confirmation. */
export type ProjectMapSessionRelations = {
  lineage: ReadonlyMap<string, AgentSessionLineageEntry>
  references: readonly AgentSessionReferenceLink[]
  nodes: ReadonlyMap<string, ProjectMapTimelineNode>
}

const EMPTY: ProjectMapSessionRelations = { lineage: new Map(), references: [], nodes: new Map() }

let current = EMPTY
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useProjectMapSessionRelations(): ProjectMapSessionRelations {
  return useSyncExternalStore(subscribe, () => current)
}

export function projectMapTimelineNode(
  relations: ProjectMapSessionRelations,
  sessionId: string
): ProjectMapTimelineNode {
  return (
    relations.nodes.get(sessionId) ?? {
      paneKey: null,
      title: translate('projectMap.node.closedSource', 'Closed chat')
    }
  )
}

/** Published while the map is open; a chat's rewind warns of the forks it cuts away from. */
export function publishProjectMapSessionRelations(next: ProjectMapSessionRelations | null): void {
  current = next ?? EMPTY
  provideNativeChatRewindImpact(next ? rewindImpact : null)
  listeners.forEach((listener) => listener())
}

function rewindImpact(rewind: {
  sessionId: string
  epoch: string
  sequence: number
}): string | null {
  const cut = projectMapForksPastRewind(current.lineage.values(), rewind)
  if (cut.length === 0) {
    return null
  }
  return translate(
    'projectMap.timeline.rewindForks',
    '{{count}} chats were handed off after this point: {{names}}. They keep what they were handed, but the point they were handed off from goes away here.',
    {
      count: cut.length,
      names: cut
        .map((entry) => projectMapTimelineNode(current, entry.childSessionId).title)
        .join(', ')
    }
  )
}

/** The map page's lineage and references, published for as long as the page is mounted. */
export function usePublishProjectMapSessionRelations(
  graph: ProjectMapGraph | null,
  lineage: ReadonlyMap<string, AgentSessionLineageEntry>,
  references: readonly AgentSessionReferenceLink[]
): void {
  useEffect(() => {
    const nodes = new Map<string, ProjectMapTimelineNode>()
    for (const agent of graph?.agents.values() ?? []) {
      if (agent.chat) {
        nodes.set(agent.chat.sessionId, {
          paneKey: agent.card.paneKey,
          title: projectMapAgentTitle(agent.card)
        })
      }
    }
    publishProjectMapSessionRelations({ lineage, references, nodes })
  }, [graph, lineage, references])
  useEffect(() => () => publishProjectMapSessionRelations(null), [])
}
