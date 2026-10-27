// The phone's view of one chat's place on the desktop project map: where it was forked from, what
// was forked from it, and which conversations its messages referenced or were referenced by. The
// canvas is a desktop surface; a phone lists the same relations under the chat.

import {
  AGENT_SESSION_FORK_RUNTIME_CAPABILITY,
  isAgentSessionLineageEntry,
  isAgentSessionLineageSession,
  type AgentSessionLineageEntry,
  type AgentSessionLineageSession
} from '../../../src/shared/agent-session-fork'
import {
  AGENT_SESSION_REFERENCES_RUNTIME_CAPABILITY,
  isAgentSessionReferenceLink,
  type AgentSessionReferenceLink
} from '../../../src/shared/agent-session-reference-link'

export type MobileChatRelationKind = 'forked-from' | 'forked-into' | 'references' | 'referenced-by'

export type MobileChatRelation = {
  kind: MobileChatRelationKind
  /** Null for a reference whose source is on another host. */
  sessionId: string | null
  title: string
  detail: string
}

export function hostRecordsChatRelations(hostCapabilities: readonly string[] | undefined): boolean {
  return hostCapabilities?.includes(AGENT_SESSION_FORK_RUNTIME_CAPABILITY) === true
}

export function hostRecordsChatReferences(
  hostCapabilities: readonly string[] | undefined
): boolean {
  return hostCapabilities?.includes(AGENT_SESSION_REFERENCES_RUNTIME_CAPABILITY) === true
}

export type MobileChatRelationReplies = {
  lineage: unknown
  references: unknown
}

function listOf<T>(value: unknown, key: string, is: (item: unknown) => item is T): T[] {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return []
  }
  const list: unknown = Reflect.get(value, key)
  return Array.isArray(list) ? list.filter(is) : []
}

/** One chat's relations, nearest first: its source, then its children, then references. */
export function mobileChatRelations(
  sessionId: string,
  replies: MobileChatRelationReplies
): MobileChatRelation[] {
  const entries = listOf<AgentSessionLineageEntry>(
    replies.lineage,
    'entries',
    isAgentSessionLineageEntry
  )
  const links = listOf<AgentSessionReferenceLink>(
    replies.references,
    'links',
    isAgentSessionReferenceLink
  )
  const sessions = new Map<string, AgentSessionLineageSession>()
  for (const reply of [replies.lineage, replies.references]) {
    for (const session of listOf(reply, 'sessions', isAgentSessionLineageSession)) {
      sessions.set(session.sessionId, session)
    }
  }
  const titleOf = (id: string): string => sessions.get(id)?.title ?? sessions.get(id)?.agent ?? id
  const relations: MobileChatRelation[] = []
  for (const entry of entries) {
    const count =
      entry.handedOverCount !== undefined && entry.handedOverCount < entry.cut.messageCount
        ? `latest ${entry.handedOverCount} of ${entry.cut.messageCount} messages`
        : `${entry.cut.messageCount} messages`
    const how = entry.mode === 'native' ? 'Forked' : 'Handed off'
    if (entry.childSessionId === sessionId) {
      relations.push({
        kind: 'forked-from',
        sessionId: entry.sourceSessionId,
        title: titleOf(entry.sourceSessionId),
        detail: `${how} from here · ${count}`
      })
    } else if (entry.sourceSessionId === sessionId) {
      relations.push({
        kind: 'forked-into',
        sessionId: entry.childSessionId,
        title: titleOf(entry.childSessionId),
        detail: `${how} from this chat · ${count}`
      })
    }
  }
  for (const link of links) {
    const at =
      link.sourceMessageCount === null ? 'live' : `through message ${link.sourceMessageCount}`
    if (link.targetSessionId === sessionId) {
      relations.push({
        kind: 'references',
        sessionId: link.source?.sessionId ?? null,
        title: link.source ? titleOf(link.source.sessionId) : link.title,
        detail: `Referenced in message ${link.messageIndex + 1} · ${at}`
      })
    } else if (link.source?.sessionId === sessionId) {
      relations.push({
        kind: 'referenced-by',
        sessionId: link.targetSessionId,
        title: titleOf(link.targetSessionId),
        detail: `Referenced this chat in message ${link.messageIndex + 1} · ${at}`
      })
    }
  }
  const order: MobileChatRelationKind[] = [
    'forked-from',
    'forked-into',
    'references',
    'referenced-by'
  ]
  return relations.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}
