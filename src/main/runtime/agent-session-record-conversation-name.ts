import { normalizeAgentSessionConversationName } from '../../shared/agent-session-conversation-name'
import type { AgentSessionRecord } from '../../shared/agent-session-record'

/**
 * Set or clear the conversation name on one record.
 *
 * Deliberately unfenced: the name is a durable note, not ownership, so writing it never contends
 * with the writer lease. Normalizing here — the only writer of the field — keeps the record's own
 * validator satisfied no matter which caller supplied the text.
 */
export function setAgentSessionRecordConversationName(
  record: AgentSessionRecord,
  name: string | null,
  now: number,
  source: AgentSessionRecord['conversationNameSource'] = 'manual'
): AgentSessionRecord {
  const normalized = name === null ? null : normalizeAgentSessionConversationName(name)
  if (
    (record.conversationName ?? null) === normalized &&
    (normalized === null || record.conversationNameSource === source)
  ) {
    return record
  }
  const next = { ...record, updatedAt: now }
  if (normalized === null) {
    delete next.conversationName
    delete next.conversationNameSource
    return next
  }
  next.conversationName = normalized
  next.conversationNameSource = source
  return next
}

export async function compareAndSetAgentSessionRecordName(
  mutate: (
    apply: (record: AgentSessionRecord) => AgentSessionRecord
  ) => Promise<AgentSessionRecord>,
  name: string | null,
  expected: string | null,
  source?: AgentSessionRecord['conversationNameSource'],
  expectedSource?: AgentSessionRecord['conversationNameSource'] | null
): Promise<AgentSessionRecord | null> {
  let matched = false
  const record = await mutate((current) => {
    matched =
      (current.conversationName ?? null) === expected &&
      (expectedSource === undefined || (current.conversationNameSource ?? null) === expectedSource)
    return matched
      ? setAgentSessionRecordConversationName(current, name, Date.now(), source)
      : current
  })
  return matched ? record : null
}

export type CompareAndSetConversationName = (
  sessionId: string,
  name: string | null,
  expected: string | null,
  source?: AgentSessionRecord['conversationNameSource'],
  expectedSource?: AgentSessionRecord['conversationNameSource'] | null
) => Promise<AgentSessionRecord | null>
