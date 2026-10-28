import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { translateMain } from '../i18n/main-i18n'
import { conversationNameSeed } from '../../shared/conversation-name-generation'
import {
  splitConversationReferences,
  withoutConversationReferenceInstructions
} from '../../shared/conversation-reference'

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

/** An unnamed child's name, in the desktop's language: a hand-off, or a merged one. */
export function forkedChatFallbackName(
  sourceName: string | null | undefined,
  sourceCount: number
): string | null {
  if (!sourceName) {
    return null
  }
  const values: Record<string, string | number> = { source: sourceName, others: sourceCount - 1 }
  const template =
    sourceCount > 1
      ? translateMain(
          'projectMap.childName.merged',
          'Merged handoff: {{source}} and {{others}} more',
          values
        )
      : translateMain('projectMap.childName.handoff', 'Handoff: {{source}}', values)
  // Before the main i18n loads, the fallback comes back uninterpolated.
  return template.replace(/\{\{(source|others)\}\}/g, (_, key: string) => String(values[key]))
}

/**
 * The namer may already have seeded from the first message, which for a hand-off is the
 * transferred conversation, not what the person asked this child to do; only a seed is replaced.
 */
export function forkedChatNameUpdate(
  child: NameFields | null,
  fallbackName: string | null,
  instruction: string | undefined
): ForkedChatNameUpdate | null {
  // Named for what the person typed, not for the references or their reading instructions.
  const typed = splitConversationReferences(
    withoutConversationReferenceInstructions(instruction ?? '')
  )
    .filter((part) => typeof part === 'string')
    .join(' ')
  const name = conversationNameSeed(typed) ?? fallbackName
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
  fallbackName: string | null,
  instruction: string | undefined
): Promise<Named | null> {
  // A second pass: the namer's seed can commit between our read and our write.
  for (let attempt = 0; attempt < 2; attempt++) {
    const update = forkedChatNameUpdate(store.getRecord(sessionId), fallbackName, instruction)
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
