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
  return template.replace(/\{\{(source|second|count)\}\}/g, (_, key: string) => String(values[key]))
}

function mergedTwoName(values: { source: string; second: string; count: number }): string {
  return interpolated(
    translateMain(
      'projectMap.childName.mergedTwo',
      'Merged handoff: {{source}} and {{second}}',
      values
    ),
    values
  )
}

// A name keeps the language it was given in, whichever the desktop shows now.
const MERGED_PREFIXES = ['Merged handoff: ', '\u5408\u5e76\u4ea4\u63a5\uff1a']
const HANDOFF_PREFIXES = [LEGACY_PREFIX, 'Handoff: ', '\u4ea4\u63a5\uff1a']

/** What a merge's own name starts with, in either language and in the desktop's own. */
function mergedPrefixes(): string[] {
  const marker = '\u0000'
  const here = mergedTwoName({ source: marker, second: '', count: 2 }).split(marker)[0]
  return [...new Set([...MERGED_PREFIXES, ...(here ? [here] : [])])]
}

/** What a hand-off's or a merge's own name starts with; merged first, being the longer. */
function handoffPrefixes(): string[] {
  const here = handoffName('\u0000').split('\u0000')[0]
  return [...mergedPrefixes(), ...new Set([...HANDOFF_PREFIXES, ...(here ? [here] : [])])]
}

/**
 * The name under its hand-off prefixes, so a hand-off of a hand-off reads "Handoff: X" once and a
 * merge of a merge does not stack "Merged handoff:".
 */
function baseChatName(name: string): string {
  const prefixes = handoffPrefixes()
  let base = name
  for (let prefix = prefixes.find((p) => base.startsWith(p)); prefix;) {
    base = base.slice(prefix.length)
    prefix = prefixes.find((p) => base.startsWith(p))
  }
  return base || name
}

/**
 * An unnamed child's name, in the desktop's language: a hand-off, or a merged one. A merge names
 * its sources as equals, in the order picked: both of two, or the first and how many in all.
 */
export function forkedChatFallbackName(
  sourceNames: readonly (string | null | undefined)[],
  sourceCount = sourceNames.length
): string | null {
  // Two chats of one title would read "A and A"; a title says each once.
  const names = [...new Set(sourceNames.flatMap((name) => (name ? [baseChatName(name)] : [])))]
  const [source, second] = names
  if (!source) {
    return null
  }
  if (sourceCount <= 1) {
    return handoffName(source)
  }
  const values = { source, second: second ?? '', count: sourceCount }
  return sourceCount === 2 && second
    ? mergedTwoName(values)
    : interpolated(
        translateMain(
          'projectMap.childName.mergedMany',
          'Merged handoff: {{source}} and others, {{count}} chats',
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
    ? forkedChatFallbackName([name], sourceCount)
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

/**
 * The current name for a merge whose automatic name an earlier build gave it: after one source,
 * with stacked prefixes, or with one title twice. Null when it already reads so, or was chosen.
 */
export function oneSourceMergeRename(
  child: NameFields,
  sourceNames: readonly (string | null | undefined)[]
): string | null {
  const name = child.conversationName ?? ''
  const automatic =
    child.conversationNameSource === undefined || child.conversationNameSource === 'seed'
  if (!automatic || sourceNames.length < 2 || !mergedPrefixes().some((p) => name.startsWith(p))) {
    return null
  }
  const next = forkedChatFallbackName(sourceNames)
  return next && next !== name ? next : null
}

/** Renames the children an older build named "Fork of …"; returns the sessions it renamed. */
export async function renameLegacyForkedChats(
  store: LegacyRenameStore,
  entries: readonly AgentSessionLineageEntry[]
): Promise<string[]> {
  const renamed: string[] = []
  for (const entry of entries) {
    const child = store.getRecord(entry.childSessionId)
    const sources = agentSessionLineageSources(entry)
    const name = child
      ? (legacyForkedChatRename(child, sources.length) ??
        oneSourceMergeRename(
          child,
          sources.map((source) => store.getRecord(source.sessionId)?.conversationName)
        ))
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
