import { z } from 'zod'
import { isAgentSessionId } from './agent-session-record'
import { SessionId } from './rpc-contract/structured-agent-session-identifiers'

/** Hosts that record which conversations a person's sent messages referenced. */
export const AGENT_SESSION_REFERENCES_RUNTIME_CAPABILITY = 'agent-session.references.v1' as const

/**
 * One conversation reference a person sent into a chat, recorded when the host accepted the
 * message: the message, not a drawn line, is what the agent actually read.
 */
export type AgentSessionReferenceLink = {
  targetSessionId: string
  /** The journal id of the message that carried the reference. */
  messageId: string
  /** Zero-based place of that message among the chat's messages when it was sent. */
  messageIndex: number
  referenceUri: string
  title: string
  /** Null when the source is on another host or its reference is not stored here. */
  source: { sessionId: string; workspaceId: string } | null
  /** How many source messages a snapshot reference reads; null when it reads live. */
  sourceMessageCount: number | null
  createdAt: number
}

export const ReferencesParams = z
  .object({ sessionIds: z.array(SessionId).max(2048).optional() })
  .strict()

const ReferenceLinkSchema = z.object({
  targetSessionId: z.string().refine(isAgentSessionId),
  messageId: z.string().min(1).max(512),
  messageIndex: z.number().int().nonnegative(),
  referenceUri: z.string().min(1).max(8192),
  title: z.string().min(1).max(1024),
  source: z
    .object({
      sessionId: z.string().refine(isAgentSessionId),
      workspaceId: z.string().min(1).max(4096)
    })
    .nullable(),
  sourceMessageCount: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative()
})

export function isAgentSessionReferenceLink(value: unknown): value is AgentSessionReferenceLink {
  return ReferenceLinkSchema.safeParse(value).success
}
