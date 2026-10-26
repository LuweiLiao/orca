import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { conversationNameSeed } from '../../shared/conversation-name-generation'

type NameFields = Pick<AgentSessionRecord, 'conversationName' | 'conversationNameSource'>

export type ForkedChatNameUpdate = {
  name: string
  expected: string | null
  expectedSource: AgentSessionRecord['conversationNameSource'] | null
}

type ForkNamingStore<Named> = {
  getRecord: (sessionId: string) => NameFields | null
  compareAndSetConversationName: (
    sessionId: string,
    name: string,
    expected: string | null,
    source: 'seed',
    expectedSource: AgentSessionRecord['conversationNameSource'] | null
  ) => Promise<Named | null>
}

/**
 * The namer may already have seeded from the first message, which for a hand-off is the
 * transferred conversation, not what the person asked this child to do; only a seed is replaced.
 */
export function forkedChatNameUpdate(
  child: NameFields | null,
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

export async function applyForkedChatName<Named>(
  store: ForkNamingStore<Named>,
  sessionId: string,
  source: Pick<AgentSessionRecord, 'conversationName'>,
  instruction: string | undefined
): Promise<Named | null> {
  // A second pass: the namer's seed can commit between our read and our write.
  for (let attempt = 0; attempt < 2; attempt++) {
    const update = forkedChatNameUpdate(store.getRecord(sessionId), source, instruction)
    if (!update) {
      return null
    }
    const named = await store.compareAndSetConversationName(
      sessionId,
      update.name,
      update.expected,
      'seed',
      update.expectedSource
    )
    if (named) {
      return named
    }
  }
  return null
}
