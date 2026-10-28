// The phone's view of one chat's place on the desktop project map: where it was forked from, what
// was forked from it, and which conversations its messages referenced or were referenced by. The
// canvas is a desktop surface; a phone lists the same relations under the chat.

import {
  AGENT_SESSION_FORK_RUNTIME_CAPABILITY,
  agentSessionLineageSources,
  isAgentSessionLineageEntry,
  isAgentSessionLineageSession,
  withoutHandoffReferences,
  type AgentSessionLineageEntry,
  type AgentSessionLineageSession
} from '../../../src/shared/agent-session-fork'
import {
  CONVERSATION_REFERENCE_RANGE_CAPABILITY,
  conversationReferenceRangeStart
} from '../../../src/shared/conversation-reference'
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
  /** The related chat's agent when the host described it, so a handoff can start from it. */
  agent: string | null
}

export function hostRecordsChatRelations(hostCapabilities: readonly string[] | undefined): boolean {
  return hostCapabilities?.includes(AGENT_SESSION_FORK_RUNTIME_CAPABILITY) === true
}

export function hostRecordsChatReferences(
  hostCapabilities: readonly string[] | undefined
): boolean {
  return hostCapabilities?.includes(AGENT_SESSION_REFERENCES_RUNTIME_CAPABILITY) === true
}

/** A host that predates ranges reads a range reference whole; that is shown as the whole span. */
export function hostReadsReferenceRanges(hostCapabilities: readonly string[] | undefined): boolean {
  return hostCapabilities?.includes(CONVERSATION_REFERENCE_RANGE_CAPABILITY) === true
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
  replies: MobileChatRelationReplies,
  options: { readsRanges?: boolean } = {}
): MobileChatRelation[] {
  const entries = listOf<AgentSessionLineageEntry>(
    replies.lineage,
    'entries',
    isAgentSessionLineageEntry
  )
  // The references a hand-off carries to its own sources are the hand-off, listed once above.
  const links = withoutHandoffReferences(
    listOf<AgentSessionReferenceLink>(replies.references, 'links', isAgentSessionReferenceLink),
    (child) => entries.find((entry) => entry.childSessionId === child)
  )
  const sessions = new Map<string, AgentSessionLineageSession>()
  for (const reply of [replies.lineage, replies.references]) {
    for (const session of listOf(reply, 'sessions', isAgentSessionLineageSession)) {
      sessions.set(session.sessionId, session)
    }
  }
  const titleOf = (id: string): string => sessions.get(id)?.title ?? sessions.get(id)?.agent ?? id
  const agentOf = (id: string): string | null => sessions.get(id)?.agent ?? null
  const relations: MobileChatRelation[] = []
  for (const entry of entries) {
    // A merged hand-off relates its child to every source, each with its own cut.
    const sources = agentSessionLineageSources(entry)
    for (const source of sources) {
      const total = source.cut.messageCount
      const count =
        source.handedOverCount !== undefined && source.handedOverCount < total
          ? `latest ${source.handedOverCount} of ${total} messages`
          : `${total} messages`
      // Every source of a merged handoff is listed alike; none is the main one.
      const label = sources.length > 1 ? `Merged handoff · ${sources.length} sources` : 'Handoff'
      if (entry.childSessionId === sessionId) {
        relations.push({
          kind: 'forked-from',
          sessionId: source.sessionId,
          title: titleOf(source.sessionId),
          detail: `${label} · this chat started from it · ${count}`,
          agent: agentOf(source.sessionId)
        })
      } else if (source.sessionId === sessionId) {
        relations.push({
          kind: 'forked-into',
          sessionId: entry.childSessionId,
          title: titleOf(entry.childSessionId),
          detail: `${label} · started from this chat · ${count}`,
          agent: agentOf(entry.childSessionId)
        })
      }
    }
  }
  for (const link of links) {
    const from = options.readsRanges ? conversationReferenceRangeStart(link.referenceUri) : null
    const at =
      link.sourceMessageCount === null
        ? 'live'
        : from !== null && from > 0 && from < link.sourceMessageCount
          ? `messages ${from + 1}–${link.sourceMessageCount}`
          : `through message ${link.sourceMessageCount}`
    if (link.targetSessionId === sessionId) {
      relations.push({
        kind: 'references',
        sessionId: link.source?.sessionId ?? null,
        title: link.source ? titleOf(link.source.sessionId) : link.title,
        detail: `Referenced in message ${link.messageIndex + 1} · ${at}`,
        agent: link.source ? agentOf(link.source.sessionId) : null
      })
    } else if (link.source?.sessionId === sessionId) {
      relations.push({
        kind: 'referenced-by',
        sessionId: link.targetSessionId,
        title: titleOf(link.targetSessionId),
        detail: `Referenced this chat in message ${link.messageIndex + 1} · ${at}`,
        agent: agentOf(link.targetSessionId)
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
