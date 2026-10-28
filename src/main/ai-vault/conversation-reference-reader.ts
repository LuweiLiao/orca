import type { AiVaultListResult, AiVaultSession } from '../../shared/ai-vault-types'
import type { AgentJournalSnapshot } from '../../shared/agent-session-journal-types'
import type {
  ConversationReferenceCreate,
  ConversationReferenceRead,
  ConversationReferenceRetarget,
  ConversationReferencePage,
  ConversationReference,
  ConversationSource
} from '../../shared/conversation-reference'
import { parseConversationReferenceUri } from '../../shared/conversation-reference'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { collectConversationReferencePage } from './conversation-reference-page'
import { conversationReferenceRangeCut } from './conversation-reference-range'
import {
  saveConversationReference,
  loadConversationReference,
  loadConversationReferenceCut,
  type ConversationReferenceCut
} from './conversation-reference-store'
import { journalItemsThrough } from '../native-chat/agent-session-journal-cut'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { readConversationTranscriptInService } from './session-scanner-service-spawn'
import { localAiVaultScanRoots, findCachedAiVaultSession } from './cached-session-list'
import { isWslUncPath } from '../../shared/wsl-paths'
import { projectStructuredAgentSessionMessages } from '../../shared/structured-agent-session-message-projection'

type ListSessions = () => Promise<AiVaultListResult>

async function resolveTranscript(
  source: Extract<ConversationSource, { kind: 'transcript' }>,
  list: ListSessions
): Promise<AiVaultSession> {
  const cached = findCachedAiVaultSession(source)
  if (cached) {
    return cached
  }
  const result = await list()
  const matches = result.sessions.filter(
    (session) =>
      session.agent === source.agent &&
      session.sessionId === source.sessionId &&
      (!source.filePath || session.filePath === source.filePath) &&
      (source.codexHome === undefined || session.codexHome === source.codexHome)
  )
  if (matches.length !== 1) {
    throw new Error(
      matches.length > 1
        ? 'More than one saved conversation matches this reference. Drag the intended history entry again.'
        : 'The source conversation is unavailable. Refresh Session History and attach it again.'
    )
  }
  return matches[0]!
}

export async function createLocalConversationReference(
  request: ConversationReferenceCreate,
  list: ListSessions
): Promise<ConversationReference> {
  const source = request.source
  if (source.kind === 'structured') {
    const host = getStructuredAgentSessionHost()
    const record = host?.deps.store.getRecord(source.sessionId)
    if (!host || !record || record.location.workspaceId !== source.workspaceId) {
      throw new Error('The source chat is unavailable.')
    }
    const cut = request.range
      ? conversationReferenceRangeCut(
          await host.journalSnapshot(record.sessionId),
          (snapshot) => [...journalConversationMessages(snapshot)],
          request.range,
          (await host.history({ sessionId: record.sessionId, direction: 'tail', limit: 1 })).page
            .working
        )
      : await conversationReferenceCut(host, record.sessionId)
    return saveConversationReference(request, record.provider, cut ?? undefined)
  }
  if (request.range) {
    throw new Error('Only an Orca chat can be referenced by a range of turns.')
  }
  const session = await resolveTranscript(source, list)
  return saveConversationReference(
    {
      ...request,
      source: { ...source, filePath: session.filePath, codexHome: session.codexHome }
    },
    session.agent
  )
}

/**
 * The source as it stands now, minus a turn still running: a reference read later must see what
 * the person saw when they made it, never a reply that was half written then.
 */
async function conversationReferenceCut(
  host: StructuredAgentSessionHost,
  sessionId: string
): Promise<ConversationReferenceCut | null> {
  const snapshot = await host.journalSnapshot(sessionId)
  const messages = [...journalConversationMessages(snapshot)]
  const working = (await host.history({ sessionId, direction: 'tail', limit: 1 })).page.working
  const lastAsk = working ? messages.findLastIndex((message) => message.role === 'user') : -1
  const kept = lastAsk >= 0 ? messages.slice(0, lastAsk) : messages
  const last = kept.at(-1)
  const item = last
    ? snapshot.items.find((candidate) => candidate.itemId === last.id)
    : snapshot.items.at(-1)
  if (!item || kept.length === 0) {
    // Nothing settled to pin yet; the reference reads the source live, as one made before cuts did.
    return null
  }
  return {
    journalItemId: item.itemId,
    journalEpoch: snapshot.cursor.epoch,
    journalSequence: item.sequence,
    messageCount: kept.length
  }
}

/**
 * A new reference to the same structured chat, live or pinned at its current settled point. The
 * old one is left as it was: a message already sent with it keeps reading what it was sent with.
 */
export async function retargetLocalConversationReference(
  request: ConversationReferenceRetarget,
  ensureHost?: () => Promise<void>
): Promise<ConversationReference | null> {
  const identity = parseConversationReferenceUri(request.reference)
  const stored = identity ? await loadConversationReference(identity.id) : null
  if (!identity || !stored) {
    return null
  }
  if (stored.source.kind !== 'structured') {
    throw new Error('Only a reference to an Orca chat can follow its source.')
  }
  await ensureHost?.()
  const host = getStructuredAgentSessionHost()
  const record = host?.deps.store.getRecord(stored.source.sessionId)
  if (!host || !record || record.location.workspaceId !== stored.source.workspaceId) {
    throw new Error('The source chat is unavailable.')
  }
  const now =
    request.follow === 'snapshot' ? await conversationReferenceCut(host, record.sessionId) : null
  // A range keeps where it starts; only its end moves up to now.
  const from = (await loadConversationReferenceCut(identity.id))?.fromMessage
  const cut = now && from ? { ...now, fromMessage: from } : now
  // The same host name the old reference carried, so it routes the way the old one did.
  return saveConversationReference(
    { source: stored.source, title: stored.title, executionHostId: identity.hostId },
    stored.agent,
    cut ?? undefined
  )
}

type JournalConversationMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  text: string
  timestamp: number | null
}

/** A chat's sent messages as plain text, the way a reference or a fork reads them. */
export function* journalConversationMessages(
  snapshot: AgentJournalSnapshot
): Generator<JournalConversationMessage> {
  for (const message of projectStructuredAgentSessionMessages(
    snapshot.items,
    [],
    snapshot.submissions
  )) {
    if (
      message.unsent ||
      (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool')
    ) {
      continue
    }
    const text = message.blocks
      .flatMap((block) => {
        if (block.type === 'text') {
          return [block.text]
        }
        if (block.type === 'tool-call') {
          return [`${block.name}\n${JSON.stringify(block.input) ?? ''}`]
        }
        if (block.type === 'tool-result') {
          return [block.output]
        }
        if (block.type === 'image-ref') {
          return [`[Image: ${block.path ?? block.url ?? block.alt ?? ''}]`]
        }
        return []
      })
      .join('\n')
    if (text) {
      yield { id: message.id, role: message.role, text, timestamp: message.timestamp }
    }
  }
}

function feedJournal(
  snapshot: AgentJournalSnapshot,
  push: ReturnType<typeof collectConversationReferencePage>['push']
): void {
  const truncated = new Set(
    snapshot.items
      .filter(({ body }) =>
        body.kind === 'tool-call'
          ? body.output?.truncated
          : body.kind === 'diff' && body.patch.truncated
      )
      .map((item) => item.itemId)
  )
  for (const message of journalConversationMessages(snapshot)) {
    push({
      role: message.role,
      text: message.text,
      timestamp: message.timestamp === null ? null : new Date(message.timestamp).toISOString(),
      ...(truncated.has(message.id) ? { textTruncated: true } : {})
    })
  }
}

export async function readLocalConversationReference(
  request: ConversationReferenceRead,
  signal?: AbortSignal,
  ensureHost?: () => Promise<void>
): Promise<ConversationReferencePage | null> {
  const identity = parseConversationReferenceUri(request.reference)
  if (!identity) {
    throw new Error('Invalid conversation reference.')
  }
  const stored = await loadConversationReference(identity.id)
  if (!stored) {
    return null
  }
  const reference = { uri: request.reference, title: stored.title, agent: stored.agent }
  if (stored.source.kind === 'structured') {
    await ensureHost?.()
    const host = getStructuredAgentSessionHost()
    const record = host?.deps.store.getRecord(stored.source.sessionId)
    if (!host || !record || record.location.workspaceId !== stored.source.workspaceId) {
      throw new Error('The source chat is unavailable.')
    }
    const snapshot = await host.journalSnapshot(record.sessionId)
    const cut = await loadConversationReferenceCut(identity.id)
    const kept = cut ? journalItemsThrough(snapshot, cut) : null
    // A snapshot's cursor stays valid while its source talks on; a live read's does not.
    const version =
      cut && kept
        ? `cut:${cut.journalEpoch}:${cut.journalSequence}`
        : `${snapshot.cursor.epoch}:${snapshot.cursor.sequence}`
    // A range starts where it was cut unless the reader asks for a later message.
    const from = kept
      ? Math.max(cut?.fromMessage ?? 0, request.fromMessage ?? 0)
      : request.fromMessage
    const page = collectConversationReferencePage(identity.id, version, {
      ...request,
      ...(from === undefined ? {} : { fromMessage: from })
    })
    feedJournal(kept ? { ...snapshot, items: kept } : snapshot, page.push)
    const finished = page.finish()
    return {
      reference,
      ...finished,
      warnings:
        cut && !kept
          ? [
              ...finished.warnings,
              'The source chat was rewound past the point this reference was made at; this is its current conversation.'
            ]
          : finished.warnings
    }
  }
  const source = stored.source
  if (!source.filePath) {
    throw new Error('The reference has no saved source location. Attach it again.')
  }
  const roots = isWslUncPath(source.filePath) ? await localAiVaultScanRoots() : null
  return {
    reference,
    ...(await readConversationTranscriptInService(
      {
        id: identity.id,
        source,
        request,
        ...(roots ? { wslOpenCodeReaders: roots.wslOpenCodeReaders } : {})
      },
      signal
    ))
  }
}
