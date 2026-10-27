// The conversations a person's sent message referenced, recorded so the project map can draw
// where a chat's context came from, mid-conversation included.

import type { AgentSessionReferenceLink } from '../../shared/agent-session-reference-link'
import type { AgentSessionLineageSession } from '../../shared/agent-session-fork'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  conversationReferenceSnapshotCount,
  parseConversationReferenceUri,
  splitConversationReferences
} from '../../shared/conversation-reference'
import { journalConversationMessages } from '../ai-vault/conversation-reference-reader'
import {
  loadConversationReference,
  loadConversationReferenceCut
} from '../ai-vault/conversation-reference-store'
import { agentSessionReferenceLinkTable } from './agent-session-journal/agent-session-reference-link-table'
import type { StructuredAgentSessionHost } from './agent-session-wire/structured-agent-session-host'

type SentMessage = {
  sessionId: string
  messageId: string
  blocks: readonly ({ type: 'text'; text: string } | { type: string })[]
}

/** The references in one accepted message, resolved against the references this host stored. */
export async function conversationReferenceLinks(
  host: Pick<StructuredAgentSessionHost, 'journalSnapshot'>,
  sent: SentMessage,
  now = Date.now()
): Promise<AgentSessionReferenceLink[]> {
  const text = sent.blocks
    .flatMap((block) => ('text' in block && typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
  const references = splitConversationReferences(text).filter((part) => typeof part !== 'string')
  if (references.length === 0) {
    return []
  }
  const messages = [...journalConversationMessages(await host.journalSnapshot(sent.sessionId))]
  const at = messages.findIndex((message) => message.id === sent.messageId)
  const messageIndex = at !== -1 ? at : messages.length
  const links = await Promise.all(
    references.map(async (reference): Promise<AgentSessionReferenceLink | null> => {
      const identity = parseConversationReferenceUri(reference.uri)
      if (!identity) {
        return null
      }
      // Only a reference this host stored names its source; one from another host stays external.
      const stored =
        identity.hostId === 'local'
          ? await loadConversationReference(identity.id).catch(() => null)
          : null
      const source = stored?.source.kind === 'structured' ? stored.source : null
      const cut = source ? await loadConversationReferenceCut(identity.id).catch(() => null) : null
      return {
        targetSessionId: sent.sessionId,
        messageId: sent.messageId,
        messageIndex,
        referenceUri: reference.uri,
        title: reference.title || stored?.title || 'Conversation',
        source: source ? { sessionId: source.sessionId, workspaceId: source.workspaceId } : null,
        sourceMessageCount: cut?.messageCount ?? conversationReferenceSnapshotCount(reference.uri),
        createdAt: now
      }
    })
  )
  return links.filter((link) => link !== null)
}

/** Best effort: a reference the map cannot draw must never fail the send that carried it. */
export async function recordConversationReferenceLinks(
  host: Pick<StructuredAgentSessionHost, 'journalSnapshot' | 'deps'>,
  sent: SentMessage
): Promise<void> {
  try {
    agentSessionReferenceLinkTable(host.deps.journalDatabase).put(
      await conversationReferenceLinks(host, sent)
    )
  } catch (error) {
    host.deps.logger.warn('recording conversation references failed', {
      scope: 'reference-links',
      sessionId: sent.sessionId,
      error
    })
  }
}

type LinkRecord = Pick<AgentSessionRecord, 'provider' | 'conversationName'> & {
  location: Pick<AgentSessionRecord['location'], 'workspaceId'>
}

/** Links touching the wanted chats, and a description of each chat on either end. */
export function agentSessionReferenceView(
  links: readonly AgentSessionReferenceLink[],
  getRecord: (sessionId: string) => LinkRecord | null | undefined,
  wanted: readonly string[] | undefined
): { links: AgentSessionReferenceLink[]; sessions: AgentSessionLineageSession[] } {
  const want = wanted ? new Set(wanted) : null
  const kept = links.filter(
    (link) =>
      getRecord(link.targetSessionId) &&
      (!want ||
        want.has(link.targetSessionId) ||
        (link.source !== null && want.has(link.source.sessionId)))
  )
  const sessions = new Map<string, AgentSessionLineageSession>()
  for (const link of kept) {
    for (const sessionId of [link.targetSessionId, link.source?.sessionId]) {
      const record = sessionId && !sessions.has(sessionId) ? getRecord(sessionId) : null
      if (sessionId && record) {
        sessions.set(sessionId, {
          sessionId,
          agent: record.provider,
          workspaceId: record.location.workspaceId,
          title: record.conversationName ?? null
        })
      }
    }
  }
  return { links: kept, sessions: [...sessions.values()] }
}
