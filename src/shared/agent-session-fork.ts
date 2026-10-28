import { z } from 'zod'
// Why the pure-JS digest: the renderer computes this too, and has no node:crypto.
import { structuredAgentSessionPayloadFingerprint } from './structured-agent-session-mutation'
import { isAgentSessionId } from './agent-session-record'
import { Identifier, SessionId } from './rpc-contract/structured-agent-session-identifiers'
import { MutationEnvelope, StructuredAgent } from './rpc-contract/structured-agent-session-params'

// Why: `agentSession.fork` and `agentSession.lineage` are new methods; an older host answers
// method_not_found, so a client offers "new child" only on a host advertising this.
export const AGENT_SESSION_FORK_RUNTIME_CAPABILITY = 'agent-session.fork.v1' as const

// Why: `ForkParams` is strict, so an older host refuses a message cut or merge sources outright;
// a client sends either only to a host advertising this.
export const AGENT_SESSION_FORK_MERGE_RUNTIME_CAPABILITY = 'agent-session.fork-merge.v1' as const

/** Chats one child can be merged from, the primary source included. */
export const AGENT_SESSION_FORK_MAX_SOURCES = 8

/** The hand-off a host sends as a child's first message carries an id with this prefix. */
export const AGENT_SESSION_FORK_MESSAGE_ID_PREFIX = 'fork-'

/**
 * Drops the references a hand-off's own first message carries to its sources: they are how the
 * agent reads what did not fit, and the hand-off already relates the two chats.
 */
export function withoutHandoffReferences<
  T extends { targetSessionId: string; messageId: string; source: { sessionId: string } | null }
>(
  links: readonly T[],
  lineageOf: (childSessionId: string) => AgentSessionLineageEntry | undefined
): T[] {
  return links.filter((link) => {
    const entry = link.messageId.startsWith(AGENT_SESSION_FORK_MESSAGE_ID_PREFIX)
      ? lineageOf(link.targetSessionId)
      : undefined
    const sourceId = link.source?.sessionId
    return !entry || !agentSessionLineageSources(entry).some((s) => s.sessionId === sourceId)
  })
}

/** Native: a provider copy of the source conversation. Transcript: the source's messages handed to a
 *  fresh conversation as its first message, for another provider or where no copy is possible. */
export type AgentSessionForkMode = 'native' | 'transcript'

/** Where a child's context was cut from its source, so a later child can start at the same point. */
export type AgentSessionForkCut = {
  /** The last source journal item the child received, and where it sat in its epoch; a later
   *  child cuts at the same sequence while the epoch is unchanged, or at the item after a rewind. */
  journalItemId: string
  journalEpoch: string
  journalSequence: number
  /** Messages the child received. */
  messageCount: number
  /** Native Claude only: the source provider conversation and its last copied message. */
  providerSessionId?: string
  providerMessageId?: string
}

/** One chat a child was handed messages from. */
export type AgentSessionLineageSource = {
  sessionId: string
  cut: AgentSessionForkCut
  sourceProvider: string
  handedOverCount?: number
}

/** One fork, recorded once by the host that created the child. */
export type AgentSessionLineageEntry = {
  childSessionId: string
  /** The conversation the child's context came from; may be an ancestor of `originSessionId`. */
  sourceSessionId: string
  /** The node the person started the fork from. */
  originSessionId: string
  mode: AgentSessionForkMode
  cut: AgentSessionForkCut
  sourceProvider: string
  createdAt: number
  /** Transcript forks only: the newest messages that fit the hand-off, when fewer than all. */
  handedOverCount?: number
  /** A merge: every chat the child was handed, the primary first and mirrored by the fields above.
   *  Absent from a single-source fork and from older hosts. */
  sources?: AgentSessionLineageSource[]
}

const ForkCut = z.discriminatedUnion('kind', [
  /** The source's last completed turn; refused while the source is working. */
  z.object({ kind: z.literal('latest') }).strict(),
  /** Where `childSessionId` was cut from this source, read from the host's own lineage. */
  z.object({ kind: z.literal('fork-point'), childSessionId: SessionId }).strict(),
  /** Through the end of the turn this user message opened, in the epoch it was read in. */
  z
    .object({
      kind: z.literal('message'),
      itemId: z.string().min(1).max(512),
      epoch: z.string().min(1).max(512)
    })
    .strict()
])

const MergeSource = z.object({ sessionId: SessionId, cut: ForkCut }).strict()

export const ForkParams = z
  .object({
    /** `sessionId` names the child this fork creates. */
    envelope: MutationEnvelope,
    sourceSessionId: SessionId,
    originSessionId: SessionId,
    cut: ForkCut,
    worktree: Identifier('Invalid worktree selector'),
    agent: StructuredAgent,
    options: z.record(z.string(), z.string()).optional(),
    /** The person's first instruction to the child; transcript forks append it to the hand-off. */
    instruction: z
      .string()
      .max(64 * 1024)
      .optional(),
    /** More chats to hand the child, after the primary source; a merge is always a transcript. */
    mergeSources: z
      .array(MergeSource)
      .min(1)
      .max(AGENT_SESSION_FORK_MAX_SOURCES - 1)
      .optional()
  })
  .strict()

export type AgentSessionForkParams = z.infer<typeof ForkParams>

export const LineageParams = z
  .object({ sessionIds: z.array(SessionId).max(2048).optional() })
  .strict()

export type AgentSessionForkResult = {
  sessionId: string
  mode: AgentSessionForkMode
  messageCount: number
  tabId?: string
}

/** Both sides fingerprint the same intent fields, so a replay with different fields conflicts. */
export function agentSessionForkFingerprint(
  params: Omit<AgentSessionForkParams, 'envelope'> & { envelope: { sessionId: string } }
): string {
  return structuredAgentSessionPayloadFingerprint({
    method: 'agentSession.fork',
    sessionId: params.envelope.sessionId,
    fields: {
      sourceSessionId: params.sourceSessionId,
      originSessionId: params.originSessionId,
      cut: params.cut,
      worktree: params.worktree,
      agent: params.agent,
      options: params.options,
      instruction: params.instruction,
      // Dropped when absent, so a single-source fork keeps the fingerprint it always had.
      mergeSources: params.mergeSources
    }
  })
}

const LineageCutSchema = z.object({
  journalItemId: z.string().min(1).max(512),
  journalEpoch: z.string().min(1).max(512),
  journalSequence: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  providerSessionId: z.string().min(1).max(512).optional(),
  providerMessageId: z.string().min(1).max(512).optional()
})

// Not strict, like the entry: an older host reading a newer row ignores what it does not know.
const LineageEntrySchema = z.object({
  childSessionId: z.string().refine(isAgentSessionId),
  sourceSessionId: z.string().refine(isAgentSessionId),
  originSessionId: z.string().refine(isAgentSessionId),
  mode: z.enum(['native', 'transcript']),
  cut: LineageCutSchema,
  sourceProvider: z.string().min(1).max(128),
  createdAt: z.number().int().nonnegative(),
  handedOverCount: z.number().int().nonnegative().optional(),
  sources: z
    .array(
      z.object({
        sessionId: z.string().refine(isAgentSessionId),
        cut: LineageCutSchema,
        sourceProvider: z.string().min(1).max(128),
        handedOverCount: z.number().int().nonnegative().optional()
      })
    )
    .max(AGENT_SESSION_FORK_MAX_SOURCES)
    .optional()
})

/** Every chat a fork was handed, the primary first; one for a fork that is not a merge. */
export function agentSessionLineageSources(
  entry: AgentSessionLineageEntry
): AgentSessionLineageSource[] {
  return entry.sources && entry.sources.length > 0
    ? entry.sources
    : [
        {
          sessionId: entry.sourceSessionId,
          cut: entry.cut,
          sourceProvider: entry.sourceProvider,
          ...(entry.handedOverCount === undefined ? {} : { handedOverCount: entry.handedOverCount })
        }
      ]
}

export function isAgentSessionLineageEntry(value: unknown): value is AgentSessionLineageEntry {
  return LineageEntrySchema.safeParse(value).success
}

/**
 * A chat at either end of a returned fork, described so the map can draw it after its tab closed.
 * Added beside `entries` in the lineage result: older clients ignore it, older hosts omit it.
 */
export type AgentSessionLineageSession = {
  sessionId: string
  agent: string
  workspaceId: string
  title: string | null
}

const LineageSessionSchema = z.object({
  sessionId: z.string().refine(isAgentSessionId),
  agent: z.string().min(1).max(128),
  workspaceId: z.string().min(1).max(4096),
  title: z.string().max(1024).nullable()
})

export function isAgentSessionLineageSession(value: unknown): value is AgentSessionLineageSession {
  return LineageSessionSchema.safeParse(value).success
}
