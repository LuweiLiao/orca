import { ownWordsLines } from './agent-delegation-grant'
import {
  AGENT_DELEGATION_COUNT_HINT,
  AGENT_DELEGATION_COUNT_START,
  agentDelegationCountAt
} from './agent-delegation-text-count'
import { agentDelegationAdmission, agentDelegationAsksBack } from './agent-delegation-text-intent'
import { readAgentDelegationTextSpec } from './agent-delegation-text-spec'
import { providerAt, type AgentDelegationProviderNames } from './agent-delegation-text-vocabulary'

/**
 * One agent request a person typed, as "创建2个claudeopus5.5" or "spawn 2 codex agents". Only
 * the person's composer reads these, and only to offer cards they then send.
 */
export type AgentDelegationTextGroup = {
  count: number
  agent: string | null
  modelWords: string[]
  /** Words after "用", "with" or "(": a model only if one matches, else task text. */
  linkedWords: string[]
  effort: string | null
  incomplete: boolean
  /** Joined to other groups by "和"/"and": dropping it would leave the request half-read. */
  chained: boolean
}

const MAX_TEXT_LENGTH = 20_000
const MAX_GROUPS = 16
const MASKED =
  /\[[^\]\n]*\]\([^)\s]*\)|<?(?:https?|orca-[a-z-]+):\/\/\S+|「[^」\n]*」|『[^』\n]*』|“[^”\n]*”|"[^"\n]*"/g
const CLAUSE_END = /[。！？!?;；\n]|\.(?=\s|$)/g

// A single-character trigger counts only after these, so "后来2个" or "打开2个" stay prose.
const SINGLE_LEAD = /^(?:|[\s\p{P}]|[我你再先就也帮给去并请多又要想])$/u
// Longest first, so "使用" is read before "用".
const CJK_TRIGGERS = [
  '创建',
  '新建',
  '新开',
  '多开',
  '开启',
  '启动',
  '编排',
  '安排',
  '派出',
  '派遣',
  '指派',
  '分派',
  '调用',
  '使用',
  '采用',
  '召唤',
  '增加',
  '添加',
  '拉起',
  '叫上',
  '找来',
  '派',
  '开',
  '用',
  '叫',
  '让',
  '来',
  '起',
  '找',
  '请',
  '加',
  '建'
]
const TRIGGER_STARTS = new Set(CJK_TRIGGERS.map((trigger) => trigger[0]))
const ENGLISH_TRIGGER =
  /^(?:spin up|fire up|bring in|spawn|create|start|launch|run|use|dispatch|orchestrate|assign|deploy|add|get)\b/i
const ENGLISH_LEAD =
  /^(?:(?:please|pls|now|then|also|so|ok|okay|go ahead and|let's|lets|let us|help me|i want you to|i'd like you to|(?:can|could|would|will) you(?: please)?)[\s,]+)*$/i
const POLITE_ENGLISH = /^(?:can|could|would|will) you\b/i

const CONJUNCTION = /^\s*(?:以及|加上|还有|再加|和|与|跟|及|加|、|[,，]|and\b|plus\b|&|\+)\s*/i
const REAL_CONJUNCTION = /^\s*(?:以及|加上|还有|和|与|跟|及|and\b|plus\b|&)\s*/i
const FOLLOW_UP = /^(?:然后|接着|另外|同时|还有|以及|并且|再|and then|then|and|plus|also)/i
const MODEL_FAMILY =
  /^(?:claude|opus|sonnet|haiku|fable|gpt|o[0-9]|gemini|grok|deepseek|qwen|kimi|glm|llama|mistral)/i

// Read only near a trigger: the words that make a request are short, and texts can be long.
const WINDOW = 240
const LOOKBACK = 60
const SOFT_BOUNDARY = /[,，、:：]/
/**
 * The agents a person asked for in their own words, as explicit as the composer's picker: a verb,
 * a count and an agent or model ("创建2个claudeopus5.5和2个codex 6.1sol分析下"). Quotes, code,
 * negations ("先别开2个claude"), questions ("要不要用2个codex？") and past or habitual use read as
 * talk about agents, not a request for them.
 */
export function parseAgentDelegationTextRequest(
  text: string,
  names: AgentDelegationProviderNames
): AgentDelegationTextGroup[] {
  if (
    text.length > MAX_TEXT_LENGTH ||
    text.includes('orca-orchestration://') ||
    !AGENT_DELEGATION_COUNT_HINT.test(text)
  ) {
    return []
  }
  const groups: AgentDelegationTextGroup[] = []
  let doubtful = false
  for (const line of ownWordsLines(text)) {
    for (const clause of clausesOf(line.replace(MASKED, ' '))) {
      const scan = scanClause(clause.text, clause.question, groups.length > 0, names)
      groups.push(...scan.groups)
      doubtful ||= scan.doubtful || hasStrayMention(clause.text, scan.read, names)
    }
  }
  if (groups.length === 0 || groups.length > MAX_GROUPS) {
    return []
  }
  // Agents asked about, or counted where no request reads them, would make the cards a smaller
  // team than the person asked for; the agent proposes cards instead.
  if (doubtful) {
    groups[0]!.incomplete = true
  }
  return groups
}

function* clausesOf(line: string): Generator<{ text: string; question: boolean }> {
  let start = 0
  for (const match of line.matchAll(CLAUSE_END)) {
    yield { text: line.slice(start, match.index), question: /[?？]/.test(match[0]) }
    start = match.index + match[0].length
  }
  yield { text: line.slice(start), question: false }
}

type Trigger = { length: number; english: boolean; followUp?: true }
/** What one clause asks for, the spans read as agent requests, and whether any was a question. */
type ClauseScan = {
  groups: AgentDelegationTextGroup[]
  read: [number, number][]
  doubtful: boolean
}

function scanClause(
  clause: string,
  question: boolean,
  followsRequest: boolean,
  names: AgentDelegationProviderNames
): ClauseScan {
  const scan: ClauseScan = { groups: [], read: [], doubtful: false }
  let politeEnglish = false
  let tail = 0
  let index = 0
  while (index < clause.length) {
    const trigger =
      triggerAt(clause, index) ??
      (followsRequest || scan.groups.length > 0 ? followUpAt(clause, index) : null)
    const chain = trigger ? readChain(clause, index + trigger.length, trigger.english, names) : null
    if (!trigger || !chain) {
      index += 1
      continue
    }
    scan.read.push([index, chain.end])
    const before = clause.slice(segmentStart(clause, index), index)
    let verdict = agentDelegationAdmission(before)
    if (verdict === 'admitted' && trigger.english && !/\p{Script=Han}/u.test(before)) {
      verdict = ENGLISH_LEAD.test(before.trimStart()) ? 'admitted' : 'doubtful'
    }
    if (verdict === 'admitted') {
      scan.groups.push(...chain.groups)
      politeEnglish ||= trigger.english && POLITE_ENGLISH.test(before.trimStart())
      tail = chain.end
    }
    scan.doubtful ||= verdict === 'doubtful'
    index = chain.end
  }
  const asksBack = agentDelegationAsksBack(clause.slice(tail), question, politeEnglish)
  return scan.groups.length > 0 && asksBack ? { groups: [], read: scan.read, doubtful: true } : scan
}

/** After a request, "然后1个codex修复" or "then 1 codex to fix it" asks for more agents. */
function followUpAt(clause: string, index: number): Trigger | null {
  const word = clause.slice(index, index + 10).match(FOLLOW_UP)?.[0]
  if (!word) {
    return null
  }
  const english = /^[a-z]/i.test(word)
  if (
    english &&
    (/[a-z0-9_']/i.test(clause[index - 1] ?? '') ||
      /[a-z0-9]/i.test(clause[index + word.length] ?? ''))
  ) {
    return null
  }
  return { length: word.length, english: false, followUp: true }
}

function hasStrayMention(
  clause: string,
  read: readonly [number, number][],
  names: AgentDelegationProviderNames
): boolean {
  for (const match of clause.matchAll(AGENT_DELEGATION_COUNT_START)) {
    const at = match.index
    if (!read.some(([start, end]) => at >= start && at < end) && readGroup(clause, at, names)) {
      return true
    }
  }
  return false
}

function triggerAt(clause: string, index: number): Trigger | null {
  const char = clause[index] ?? ''
  if (TRIGGER_STARTS.has(char)) {
    const cjk = CJK_TRIGGERS.find((trigger) => clause.startsWith(trigger, index))
    if (cjk && (cjk.length > 1 || SINGLE_LEAD.test(clause[index - 1] ?? ''))) {
      return { length: cjk.length, english: false }
    }
    return null
  }
  if (!/[a-z]/i.test(char) || /[a-z0-9_']/i.test(clause[index - 1] ?? '')) {
    return null
  }
  const english = clause.slice(index, index + 16).match(ENGLISH_TRIGGER)?.[0]
  return english ? { length: english.length, english: true } : null
}

function segmentStart(clause: string, index: number): number {
  const floor = Math.max(0, index - LOOKBACK)
  for (let at = index - 1; at >= floor; at--) {
    if (SOFT_BOUNDARY.test(clause[at]!)) {
      return at + 1
    }
  }
  return floor
}

function readChain(
  clause: string,
  start: number,
  english: boolean,
  names: AgentDelegationProviderNames
): { groups: AgentDelegationTextGroup[]; end: number } | null {
  const particle = clause.slice(start, start + 4).match(english ? /^\s+/ : /^[出起上]?\s*/)?.[0]
  const first = particle === undefined ? null : readGroup(clause, start + particle.length, names)
  if (!first) {
    return null
  }
  const groups = [first.group]
  let { end } = first
  while (groups.length < MAX_GROUPS) {
    const conjunction = clause.slice(end, end + 8).match(CONJUNCTION)?.[0]
    if (!conjunction) {
      break
    }
    const next = readGroup(clause, end + conjunction.length, names)
    if (next) {
      groups.push(next.group)
      end = next.end
      continue
    }
    // "2个claude和codex": a second agent with no count of its own leaves the request unclear.
    const rest = clause.slice(end + conjunction.length, end + conjunction.length + WINDOW)
    if (REAL_CONJUNCTION.test(conjunction) && providerAt(rest, names)) {
      groups.at(-1)!.incomplete = true
    }
    break
  }
  if (groups.length > 1) {
    for (const group of groups) {
      group.chained = true
    }
  }
  return { groups, end }
}

function readGroup(
  clause: string,
  start: number,
  names: AgentDelegationProviderNames
): { group: AgentDelegationTextGroup; end: number } | null {
  const count = agentDelegationCountAt(clause.slice(start, start + 12))
  if (!count) {
    return null
  }
  const specStart = start + count.length
  const spec = readAgentDelegationTextSpec(clause.slice(specStart, specStart + WINDOW), names)
  if (!spec) {
    return null
  }
  const linkStart = spec.linkStart ?? spec.modelWords.length
  const modelWords = spec.modelWords.slice(0, linkStart)
  // Without an agent's name, only a model family makes the words a request ("2个GPU" is not).
  if (!spec.agent && !MODEL_FAMILY.test(modelWords[0] ?? '')) {
    return null
  }
  return {
    group: {
      count: count.count,
      agent: spec.agent,
      modelWords,
      linkedWords: spec.modelWords.slice(linkStart),
      effort: spec.effort,
      incomplete: spec.incomplete,
      chained: false
    },
    end: specStart + spec.end
  }
}
