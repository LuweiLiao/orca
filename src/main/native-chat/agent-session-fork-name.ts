import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { conversationNameSeed } from '../../shared/conversation-name-generation'

export type ForkedChatNameUpdate = {
  name: string
  expected: string | null
  expectedSource: AgentSessionRecord['conversationNameSource'] | null
}

/**
 * The namer may already have seeded from the first message, which for a hand-off is the
 * transferred conversation, not what the person asked this child to do; only a seed is replaced.
 */
export function forkedChatNameUpdate(
  child: Pick<AgentSessionRecord, 'conversationName' | 'conversationNameSource'> | null,
  source: Pick<AgentSessionRecord, 'conversationName'>,
  instruction: string | undefined
): ForkedChatNameUpdate | null {
  const name =
    conversationNameSeed(instruction ?? '') ??
    (source.conversationName ? `Fork of ${source.conversationName}` : null)
  const expected = child?.conversationName ?? null
  const expectedSource = child?.conversationNameSource ?? null
  if (!name || (expected !== null && expectedSource !== 'seed')) {
    return null
  }
  return { name, expected, expectedSource }
}
