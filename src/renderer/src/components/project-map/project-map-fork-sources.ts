import { latestAgentSessionContextClearSequence } from '../../../../shared/agent-session/conversation-context/agent-session-context-clear'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import {
  nativeChatForkInventory,
  nativeChatLatestForkItemId
} from '../../../../shared/native-chat/transcript/turns/native-chat-fork-offer'
import type { ProjectMapAgent } from './project-map-graph'

/** A chat the map reaches by runtime RPC; SSH and WSL panes are not structured runtime chats. */
export function projectMapReachableChat(
  agent: ProjectMapAgent | undefined
): ProjectMapAgent['chat'] {
  return agent?.chat?.executionHostId &&
    agent.card.hostKind !== 'ssh' &&
    agent.card.hostKind !== 'wsl'
    ? agent.chat
    : undefined
}

export type ProjectMapForkSource = {
  agent: ProjectMapAgent
  /** 0 is the clicked node, 1 its parent, 2 its grandparent... */
  depth: number
}

/**
 * The clicked chat and each ancestor that a native fork can copy into the clicked node's
 * workspace: same host and same agent, since a fork continues the source's own conversation.
 */
export function projectMapForkSources(
  clicked: ProjectMapAgent,
  agents: ReadonlyMap<string, ProjectMapAgent>
): ProjectMapForkSource[] {
  const origin = projectMapReachableChat(clicked)
  if (!origin) {
    return []
  }
  const sources: ProjectMapForkSource[] = []
  const seen = new Set<string>()
  let cursor: ProjectMapAgent | undefined = clicked
  let depth = 0
  while (cursor && !seen.has(cursor.card.paneKey)) {
    seen.add(cursor.card.paneKey)
    const chat = projectMapReachableChat(cursor)
    if (chat && chat.executionHostId === origin.executionHostId && chat.agent === origin.agent) {
      sources.push({ agent: cursor, depth })
    }
    cursor = cursor.parentPaneKey ? agents.get(cursor.parentPaneKey) : undefined
    depth += 1
  }
  return sources
}

/** The newest finished response still in context, as `/fork` picks it; undefined when none. */
export function projectMapLatestForkItemId(
  items: readonly AgentJournalRenderItem[]
): string | undefined {
  return nativeChatLatestForkItemId(items, {
    contextFloorSequence: latestAgentSessionContextClearSequence(items),
    forkableItemIds: nativeChatForkInventory(items).forkableItemIds
  })
}
