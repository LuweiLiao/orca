import {
  agentSessionLineageSources,
  type AgentSessionLineageEntry
} from '../../shared/agent-session-fork'
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

const LEGACY_PREFIX = 'Fork of '

function handoffName(source: string): string {
  return interpolated(
    translateMain('projectMap.childName.handoff', 'Handoff: {{source}}', { source }),
    { source }
  )
}

// Before the main i18n loads, the fallback comes back uninterpolated.
function interpolated(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(source|others)\}\}/g, (_, key: string) => String(values[key]))
}

/** The name under its hand-off prefixes, so a hand-off of a hand-off reads "Handoff: X" once. */
function baseChatName(name: string): string {
  const marker = '\u0000'
  const prefixes = [LEGACY_PREFIX, 'Handoff: ', handoffName(marker).split(marker)[0] ?? '']
  let base = name
  for (let prefix = prefixes.find((p) => p && base.startsWith(p)); prefix;) {
    base = base.slice(prefix.length)
    prefix = prefixes.find((p) => p && base.startsWith(p))
  }
  return base || name
}

/** An unnamed child's name, in the desktop's language: a hand-off, or a merged one. */
export function forkedChatFallbackName(
  sourceName: string | null | undefined,
  sourceCount: number
): string | null {
  if (!sourceName) {
    return null
  }
  const source = baseChatName(sourceName)
  if (sourceCount <= 1) {
    return handoffName(source)
  }
  const values = { source, others: sourceCount - 1 }
  return interpolated(
    translateMain(
      'projectMap.childName.merged',
      'Merged handoff: {{source}} and {{others}} more',
      values
    ),
    values
  )
}

/**
 * The new name for a child still auto-named "Fork of …" by an older build; null for a name the
 * person or the namer chose.
 */
export function legacyForkedChatRename(child: NameFields, sourceCount: number): string | null {
  const name = child.conversationName
  const automatic =
    child.conversationNameSource === undefined || child.conversationNameSource === 'seed'
  return name?.startsWith(LEGACY_PREFIX) && automatic
    ? forkedChatFallbackName(name, sourceCount)
    : null
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

type LegacyRenameStore = {
  getRecord: (sessionId: string) => NameFields | null
  compareAndSetConversationName: (
    sessionId: string,
    name: string,
    expected: string | null,
    source: 'seed',
    expectedSource: AgentSessionRecord['conversationNameSource'] | null
  ) => Promise<unknown>
}

/** Renames the children an older build named "Fork of …"; returns the sessions it renamed. */
export async function renameLegacyForkedChats(
  store: LegacyRenameStore,
  entries: readonly AgentSessionLineageEntry[]
): Promise<string[]> {
  const renamed: string[] = []
  for (const entry of entries) {
    const child = store.getRecord(entry.childSessionId)
    const name = child
      ? legacyForkedChatRename(child, agentSessionLineageSources(entry).length)
      : null
    if (!child || !name) {
      continue
    }
    const done = await store.compareAndSetConversationName(
      entry.childSessionId,
      name,
      child.conversationName ?? null,
      'seed',
      child.conversationNameSource ?? null
    )
    if (done) {
      renamed.push(entry.childSessionId)
    }
  }
  return renamed
}
