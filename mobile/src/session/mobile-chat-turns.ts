import { AGENT_SESSION_CONVERSATION_OUTLINE_RUNTIME_CAPABILITY } from '../../../src/shared/agent-session-runtime-capabilities'
import { AGENT_SESSION_ATTENTION_ACK_RUNTIME_CAPABILITY } from '../../../src/shared/agent-session-attention-capabilities'
import type { AgentJournalCursor } from '../../../src/shared/agent-session-journal-types'
import type { RpcClient } from '../transport/rpc-client'
import { callAgentSession } from './mobile-structured-agent-session-rpc'

export type MobileChatTurn = {
  itemId: string
  /** One-based place among the chat's turns. */
  number: number
  preview: string
  reply: string | null
}

export type MobileChatTurns = {
  turns: MobileChatTurn[]
  cursor: AgentJournalCursor | null
  /** Oldest turns the host left out to fit one reply. */
  omitted: number
}

export function hostReadsChatTurns(hostCapabilities: readonly string[] | undefined): boolean {
  return hostCapabilities?.includes(AGENT_SESSION_CONVERSATION_OUTLINE_RUNTIME_CAPABILITY) === true
}

export function hostAcknowledgesChatAttention(
  hostCapabilities: readonly string[] | undefined
): boolean {
  return hostCapabilities?.includes(AGENT_SESSION_ATTENTION_ACK_RUNTIME_CAPABILITY) === true
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function readCursor(value: unknown): AgentJournalCursor | null {
  const epoch = field(value, 'epoch')
  const sequence = field(value, 'sequence')
  return typeof epoch === 'string' && typeof sequence === 'number' ? { epoch, sequence } : null
}

/**
 * The turns of an outline reply, as the desktop timeline counts them: a message that steered a
 * running turn belongs to that turn. Fields an older or newer host adds or drops read as absent.
 */
export function mobileChatTurns(reply: unknown): MobileChatTurns {
  const list = field(reply, 'entries')
  const turns: MobileChatTurn[] = []
  for (const entry of Array.isArray(list) ? list : []) {
    const itemId = field(entry, 'itemId')
    if (typeof itemId !== 'string' || field(entry, 'turnKey') !== undefined) {
      continue
    }
    const imageCount = field(entry, 'imageCount')
    const images = typeof imageCount === 'number' ? imageCount : 0
    const preview = field(entry, 'preview')
    const text = typeof preview === 'string' ? preview : ''
    const answer = field(entry, 'reply')
    turns.push({
      itemId,
      number: turns.length + 1,
      preview: text || (images > 0 ? `${images} image${images === 1 ? '' : 's'}` : 'Message'),
      reply: typeof answer === 'string' && answer ? answer : null
    })
  }
  const omitted = field(reply, 'omittedEntries')
  return {
    turns,
    cursor: readCursor(field(reply, 'cursor')),
    omitted: typeof omitted === 'number' ? omitted : 0
  }
}

export async function readMobileChatTurns(
  client: RpcClient,
  sessionId: string
): Promise<MobileChatTurns> {
  return mobileChatTurns(
    await callAgentSession<unknown>(client, 'agentSession.conversationOutline', { sessionId })
  )
}

/** Reads the chat to its newest message, then tells its host so the alerts it pushed are withdrawn. */
export async function markMobileChatRead(client: RpcClient, sessionId: string): Promise<boolean> {
  const { cursor } = await readMobileChatTurns(client, sessionId)
  if (!cursor) {
    return false
  }
  const result = await callAgentSession<unknown>(client, 'agentSession.acknowledgeAttention', {
    sessionId,
    observedCursor: cursor
  })
  return field(result, 'acknowledged') === true
}
