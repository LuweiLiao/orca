// What a fork takes from its source chat: the messages up to the cut, and a native Claude copy
// when the child can resume one.

import { isAbsolute } from 'node:path'
import type { AgentJournalSnapshot } from '../../shared/agent-session-journal-types'
import type {
  AgentSessionForkCut,
  AgentSessionForkParams,
  AgentSessionLineageEntry
} from '../../shared/agent-session-fork'
import {
  buildAgentSessionHandoffPrompt,
  type AgentSessionHandoffMessage
} from '../../shared/agent-session-fork-context'
import { buildAgentSessionMergeHandoffPrompt } from '../../shared/agent-session-merge-handoff'
import { isLegacyAgentSessionAccountHome } from '../../shared/agent-session-account-home'
import { agentSessionProviderHandleChainHead } from '../../shared/agent-session-provider-handle'
import { pendingAgentSessionRewindFork } from '../../shared/agent-session-rewind'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { isWslUncPath } from '../../shared/wsl-paths'
import { journalConversationMessages } from '../ai-vault/conversation-reference-reader'
import { journalItemsThrough } from './agent-session-journal-cut'
import { forkClaudeTranscript } from '../claude/claude-rewind-transcript'
import { structuredAgentRuntimeRegistration } from '../runtime/structured-agent-runtime-registrations'
import type { StructuredAgentSessionHost } from './agent-session-wire/structured-agent-session-host'

export type ForkSourceMessages = {
  messages: (AgentSessionHandoffMessage & { id: string })[]
  cut: Omit<AgentSessionForkCut, 'providerSessionId' | 'providerMessageId'>
  /** The cut takes the source's last turn, so it must not be read while that turn runs. */
  reachesLatest: boolean
}

/** The source's messages through the cut. Refuses a cut whose place the source no longer has. */
export function forkSourceMessages(
  snapshot: AgentJournalSnapshot,
  cut: AgentSessionForkParams['cut'],
  forkPoint: AgentSessionLineageEntry | null
): ForkSourceMessages {
  const point = cut.kind === 'fork-point' ? forkPoint?.cut : undefined
  if (cut.kind === 'fork-point' && !point) {
    throw new Error('That fork point is not recorded on this host.')
  }
  const kept = point
    ? itemsThrough(snapshot, point)
    : cut.kind === 'message'
      ? itemsThroughTurn(snapshot, cut)
      : snapshot.items
  const messages = [...journalConversationMessages({ ...snapshot, items: kept })].map(
    ({ id, role, text }) => ({ id, role, text })
  )
  const last = kept.at(-1)
  if (!last || messages.length === 0) {
    throw new Error('The source chat has no messages to continue from yet.')
  }
  return {
    messages,
    cut: {
      journalItemId: last.itemId,
      journalEpoch: snapshot.cursor.epoch,
      journalSequence: last.sequence,
      messageCount: messages.length
    },
    reachesLatest: kept.length === snapshot.items.length
  }
}

/** Through the end of the turn a user message opened: everything before the next user message. */
function itemsThroughTurn(
  snapshot: AgentJournalSnapshot,
  cut: { itemId: string; epoch: string }
): AgentJournalSnapshot['items'] {
  if (cut.epoch !== snapshot.cursor.epoch) {
    throw new Error('The source chat changed since that message was read; pick the message again.')
  }
  const said = [...journalConversationMessages(snapshot)]
  const at = said.findIndex((message) => message.id === cut.itemId && message.role === 'user')
  if (at === -1) {
    throw new Error('That message is not in the source chat any more.')
  }
  const next = said.slice(at + 1).find((message) => message.role === 'user')
  const end = next ? snapshot.items.find((item) => item.itemId === next.id)?.sequence : undefined
  return end === undefined ? snapshot.items : snapshot.items.filter((item) => item.sequence < end)
}

function itemsThrough(
  snapshot: AgentJournalSnapshot,
  point: AgentSessionForkCut
): AgentJournalSnapshot['items'] {
  const items = journalItemsThrough(snapshot, point)
  if (!items) {
    throw new Error('The source chat was rewound past that fork point; start from its latest turn.')
  }
  return items
}

/**
 * The person's instruction, after the source's messages when they travel as text. When the
 * earliest messages do not fit, `referenceSource` makes a reference the child can read them through.
 */
export async function forkHandoffText(input: {
  source: Pick<AgentSessionRecord, 'conversationName' | 'provider'>
  messages: readonly AgentSessionHandoffMessage[]
  instruction?: string
  referenceSource?: () => Promise<string | null>
}): Promise<{ text: string; handedOver: number }> {
  const build = (sourceReference: string | null) =>
    buildAgentSessionHandoffPrompt({
      messages: input.messages,
      sourceLabel: input.source.conversationName ?? null,
      agentLabel: input.source.provider,
      instruction: input.instruction ?? null,
      sourceReference
    })
  const first = build(null)
  if (!first) {
    throw new Error('The source chat has no messages to continue from yet.')
  }
  if (first.handedOver === input.messages.length || !input.referenceSource) {
    return first
  }
  const reference = await input.referenceSource().catch(() => null)
  return (reference ? build(reference) : null) ?? first
}

/** One section of a merge hand-off: a source's messages, and how to reference what did not fit. */
export type ForkMergeSection = {
  source: Pick<AgentSessionRecord, 'conversationName' | 'provider'>
  messages: readonly AgentSessionHandoffMessage[]
  referenceSource?: () => Promise<string | null>
}

/**
 * The first message of a child merged from several chats. A source that does not fit whole gets a
 * reference to read the rest through; the budget is shared before any reference is made.
 */
export async function forkMergeHandoffText(input: {
  sections: readonly ForkMergeSection[]
  instruction?: string
}): Promise<{ text: string; handedOver: number[] }> {
  const build = (references: readonly (string | null)[]) =>
    buildAgentSessionMergeHandoffPrompt({
      sources: input.sections.map((section, index) => ({
        messages: section.messages,
        sourceLabel: section.source.conversationName ?? null,
        agentLabel: section.source.provider,
        sourceReference: references[index] ?? null
      })),
      instruction: input.instruction ?? null
    })
  const first = build([])
  if (!first) {
    throw new Error('The chats to merge have no messages to continue from yet.')
  }
  const references = await Promise.all(
    input.sections.map((section, index) =>
      first.handedOver[index]! < first.totals[index]! && section.referenceSource
        ? section.referenceSource().catch(() => null)
        : Promise.resolve(null)
    )
  )
  return references.some(Boolean) ? (build(references) ?? first) : first
}

/**
 * A new Claude transcript beside the source's, unowned, for the child to adopt. Null when only a
 * hand-off can carry the context: another provider, another workspace, a rewind still pending, or a
 * source account this build cannot read from.
 */
export async function copyClaudeForkSource(input: {
  host: StructuredAgentSessionHost
  source: AgentSessionRecord
  forkPoint: AgentSessionForkCut | undefined
  workspaceCwd: string
}): Promise<{ providerSessionId: string; lastSourceMessageId: string; copyOf: string } | null> {
  const { source } = input
  const head = agentSessionProviderHandleChainHead(source.providerHandleChain)
  const registration = structuredAgentRuntimeRegistration(source.provider)
  const importer = registration?.transcriptImport
  if (
    source.provider !== 'claude' ||
    !head ||
    !registration ||
    !importer ||
    !isLegacyAgentSessionAccountHome(source.accountHome) ||
    pendingAgentSessionRewindFork(source.rewind, head.handle.nativeId) !== null
  ) {
    return null
  }
  if (input.forkPoint && !input.forkPoint.providerMessageId) {
    return null
  }
  const providerSessionId =
    input.forkPoint?.providerSessionId ?? registration.sessionHistory.rowSessionId(head)
  if (!providerSessionId.trim()) {
    return null
  }
  const launchEnv = {
    ...process.env,
    ...(await input.host.deps.resolveLaunchEnv?.(source.provider))
  }
  const store = importer.conversationStore({ accountHome: source.accountHome, launchEnv })
  const path = store
    ? await importer.findTranscript({
        providerSessionId,
        store,
        launchEnv,
        workspaceCwd: input.workspaceCwd
      })
    : null
  if (!path || !isAbsolute(path) || isWslUncPath(path)) {
    return null
  }
  const copy = await forkClaudeTranscript(
    path,
    providerSessionId,
    input.forkPoint?.providerMessageId
  )
  return {
    providerSessionId: copy.sessionId,
    lastSourceMessageId: copy.lastSourceMessageId,
    copyOf: providerSessionId
  }
}
