import { z } from 'zod'
// Why the pure-JS digest: the renderer computes this too, and has no node:crypto.
import { structuredAgentSessionPayloadFingerprint } from './structured-agent-session-mutation'
import { isAgentSessionId } from './agent-session-record'
import { Identifier, SessionId } from './rpc-contract/structured-agent-session-identifiers'
import { MutationEnvelope, StructuredAgent } from './rpc-contract/structured-agent-session-params'

// Why: `agentSession.fork` and `agentSession.lineage` are new methods; an older host answers
// method_not_found, so a client offers "new child" only on a host advertising this.
export const AGENT_SESSION_FORK_RUNTIME_CAPABILITY = 'agent-session.fork.v1' as const

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
}

const ForkCut = z.discriminatedUnion('kind', [
  /** The source's last completed turn; refused while the source is working. */
  z.object({ kind: z.literal('latest') }).strict(),
  /** Where `childSessionId` was cut from this source, read from the host's own lineage. */
  z.object({ kind: z.literal('fork-point'), childSessionId: SessionId }).strict()
])

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
      instruction: params.instruction
    }
  })
}

const LineageEntrySchema = z.object({
  childSessionId: z.string().refine(isAgentSessionId),
  sourceSessionId: z.string().refine(isAgentSessionId),
  originSessionId: z.string().refine(isAgentSessionId),
  mode: z.enum(['native', 'transcript']),
  cut: z.object({
    journalItemId: z.string().min(1).max(512),
    journalEpoch: z.string().min(1).max(512),
    journalSequence: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    providerSessionId: z.string().min(1).max(512).optional(),
    providerMessageId: z.string().min(1).max(512).optional()
  }),
  sourceProvider: z.string().min(1).max(128),
  createdAt: z.number().int().nonnegative()
})

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
