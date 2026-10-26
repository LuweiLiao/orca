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
import { isLegacyAgentSessionAccountHome } from '../../shared/agent-session-account-home'
import { agentSessionProviderHandleChainHead } from '../../shared/agent-session-provider-handle'
import { pendingAgentSessionRewindFork } from '../../shared/agent-session-rewind'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { isWslUncPath } from '../../shared/wsl-paths'
import { journalConversationMessages } from '../ai-vault/conversation-reference-reader'
import { forkClaudeTranscript } from '../claude/claude-rewind-transcript'
import { structuredAgentRuntimeRegistration } from '../runtime/structured-agent-runtime-registrations'
import type { StructuredAgentSessionHost } from './agent-session-wire/structured-agent-session-host'

export type ForkSourceMessages = {
  messages: (AgentSessionHandoffMessage & { id: string })[]
  cut: Omit<AgentSessionForkCut, 'providerSessionId' | 'providerMessageId'>
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
  const kept = point ? itemsThrough(snapshot, point) : snapshot.items
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
    }
  }
}

/** Within the recorded epoch the sequence holds; after a rewind or clear only the item itself can. */
function itemsThrough(
  snapshot: AgentJournalSnapshot,
  point: AgentSessionForkCut
): AgentJournalSnapshot['items'] {
  const through =
    point.journalEpoch === snapshot.cursor.epoch
      ? point.journalSequence
      : snapshot.items.find((item) => item.itemId === point.journalItemId)?.sequence
  if (through === undefined) {
    throw new Error('The source chat was rewound past that fork point; start from its latest turn.')
  }
  return snapshot.items.filter((item) => item.sequence <= through)
}

/** The person's instruction, after the source's messages when they travel as text. */
export function forkHandoffText(input: {
  source: Pick<AgentSessionRecord, 'conversationName' | 'provider'>
  messages: readonly AgentSessionHandoffMessage[]
  instruction?: string
}): string {
  const text = buildAgentSessionHandoffPrompt({
    messages: input.messages,
    sourceLabel: input.source.conversationName ?? null,
    agentLabel: input.source.provider,
    instruction: input.instruction ?? null
  })
  if (!text) {
    throw new Error('The source chat has no messages to continue from yet.')
  }
  return text
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
