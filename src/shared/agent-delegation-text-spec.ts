import {
  ASCII_BLOCKERS,
  ASCII_FILLERS,
  ASCII_LINKS,
  ASCII_STOPS,
  CJK_BLOCKERS,
  CJK_EFFORT_KEYWORDS,
  CJK_EFFORT_VALUES,
  CJK_FILLERS,
  CJK_LINKS,
  agentDelegationEffortWord,
  providerAt,
  readAsciiToken,
  startsWithAny,
  type AgentDelegationProviderNames
} from './agent-delegation-text-vocabulary'

/** What the words after a count name: an agent, a model and an effort, as the person typed them. */
export type AgentDelegationTextSpec = {
  agent: string | null
  /** Model words as typed; the agent's catalog decides what they name. */
  modelWords: string[]
  /** Where words after "用", "with" or "(" start: they name a model only if one matches. */
  linkStart: number | null
  effort: string | null
  /** Part of the request could not be read, so no card is made from it. */
  incomplete: boolean
  /** Characters of the source the spec covers. */
  end: number
}

type SpecState = Omit<AgentDelegationTextSpec, 'end'>
type TokenRun = { end: number; tokens: number; blocked: boolean }
type Step =
  | { kind: 'stop' }
  | { kind: 'blocked' }
  | { kind: 'filler' | 'word' | 'model-keyword'; length: number }

const MAX_SPEC_TOKENS = 8
const SEPARATOR = /^\s+/
const INNER_SEPARATOR = /^[\s,，、]+/
const VALUE_LEAD = /^[\s:：=]*/
const PAREN_OPEN = /^[(（]/
const PAREN_CLOSE = /[)）]/
const BLOCKED_AFTER = new RegExp(`^\\s*的?\\s*(?:${CJK_BLOCKERS.join('|')})`)

function readEffortValue(after: string): { effort: string; length: number } | null {
  const lead = after.match(VALUE_LEAD)![0]
  const rest = after.slice(lead.length)
  const cjk = CJK_EFFORT_VALUES.find(([word]) => rest.startsWith(word))
  if (cjk) {
    return { effort: cjk[1], length: lead.length + cjk[0].length }
  }
  const token = readAsciiToken(rest)
  const effort = token ? agentDelegationEffortWord(token.text) : null
  return effort && token ? { effort, length: lead.length + token.length } : null
}

function wordAhead(after: string): boolean {
  const lead = after.match(/^\s*/)![0]
  const word = readAsciiToken(after.slice(lead.length))?.text.toLowerCase()
  return (
    word !== undefined && /^[a-z]/.test(word) && !ASCII_STOPS.has(word) && !ASCII_BLOCKERS.has(word)
  )
}

function readEffortKeyword(state: SpecState, after: string, keywordLength: number): Step {
  const value = readEffortValue(after)
  if (value) {
    state.effort = value.effort
    return { kind: 'word', length: keywordLength + value.length }
  }
  // "high effort": the value came first, as a word the model words already took.
  const last = state.modelWords.at(-1)
  const prior = last ? agentDelegationEffortWord(last) : null
  if (!prior) {
    state.incomplete = true
    return { kind: 'stop' }
  }
  state.modelWords.pop()
  if (state.linkStart !== null) {
    state.linkStart = Math.min(state.linkStart, state.modelWords.length)
  }
  state.effort = prior
  return { kind: 'word', length: keywordLength }
}

function readCjkStep(rest: string, state: SpecState): Step {
  if (startsWithAny(rest, CJK_BLOCKERS)) {
    return { kind: 'blocked' }
  }
  const keyword = startsWithAny(rest, CJK_EFFORT_KEYWORDS)
  if (keyword) {
    const value = readEffortValue(rest.slice(keyword.length))
    if (!value) {
      state.incomplete = true
      return { kind: 'stop' }
    }
    state.effort = value.effort
    return { kind: 'word', length: keyword.length + value.length }
  }
  const link = startsWithAny(rest, CJK_LINKS)
  if (link) {
    return /^\s*[a-z]/i.test(rest.slice(link.length))
      ? linked(state, link.length)
      : { kind: 'stop' }
  }
  const filler = startsWithAny(rest, CJK_FILLERS)
  const colon = filler === '模型' ? rest.slice(2).match(/^\s*[:：=]/)?.[0] : undefined
  if (colon) {
    return { kind: 'model-keyword', length: 2 + colon.length }
  }
  return filler ? { kind: 'filler', length: filler.length } : { kind: 'stop' }
}

/** Words after "用" or "with" may name a model or may be task text ("用react写"). */
function linked(state: SpecState, length: number): Step {
  state.linkStart ??= state.modelWords.length
  return { kind: 'filler', length }
}

function readAsciiStep(rest: string, state: SpecState, names: AgentDelegationProviderNames): Step {
  const token = readAsciiToken(rest)
  if (!token) {
    return { kind: 'stop' }
  }
  const word = token.text.toLowerCase()
  const provider = providerAt(rest, names)
  if (provider && !provider.glued) {
    // A second agent in one spec ("2个claude codex") is not a request this reads.
    if (state.agent && state.agent !== provider.agent) {
      state.incomplete = true
      return { kind: 'stop' }
    }
    state.agent = provider.agent
    return { kind: 'word', length: provider.length }
  }
  if (ASCII_STOPS.has(word)) {
    return { kind: 'stop' }
  }
  if (ASCII_BLOCKERS.has(word)) {
    return { kind: 'blocked' }
  }
  if (word === 'effort') {
    return readEffortKeyword(state, rest.slice(token.length), token.length)
  }
  if (provider && !state.agent) {
    state.agent = provider.agent
  }
  const colon = /^models?$/.test(word) ? rest.slice(token.length).match(/^\s*[:=]/)?.[0] : undefined
  if (colon) {
    return { kind: 'model-keyword', length: token.length + colon.length }
  }
  if (ASCII_FILLERS.has(word)) {
    return { kind: 'filler', length: token.length }
  }
  if (ASCII_LINKS.has(word)) {
    return wordAhead(rest.slice(token.length)) ? linked(state, token.length) : { kind: 'stop' }
  }
  if (!state.agent && state.modelWords.length === 0 && !/[a-z]/.test(word)) {
    return { kind: 'stop' }
  }
  state.modelWords.push(token.text)
  return { kind: 'word', length: token.length }
}

/** "(opus，负责前端)": words in parentheses name a model only if one matches, like linked words. */
function readParenStep(rest: string, state: SpecState, names: AgentDelegationProviderNames): Step {
  const close = rest.slice(0, 80).search(PAREN_CLOSE)
  if (close === -1) {
    return { kind: 'stop' }
  }
  const linkStart = state.linkStart
  state.linkStart ??= state.modelWords.length
  const run = readTokens(rest.slice(1, close), 0, state, names, true)
  if (run.blocked) {
    return { kind: 'blocked' }
  }
  if (run.tokens === 0) {
    state.linkStart = linkStart
    return { kind: 'stop' }
  }
  return { kind: 'word', length: close + 1 }
}

function readStep(
  rest: string,
  state: SpecState,
  names: AgentDelegationProviderNames,
  inner: boolean
): Step {
  if (PAREN_OPEN.test(rest)) {
    return inner ? { kind: 'stop' } : readParenStep(rest, state, names)
  }
  return /^\p{Script=Han}/u.test(rest)
    ? readCjkStep(rest, state)
    : readAsciiStep(rest, state, names)
}

function readTokens(
  source: string,
  start: number,
  state: SpecState,
  names: AgentDelegationProviderNames,
  inner: boolean
): TokenRun {
  const separator = inner ? INNER_SEPARATOR : SEPARATOR
  let index = start
  let end = start
  let tokens = 0
  let expectsModel = false
  for (let step = 0; step < MAX_SPEC_TOKENS * 2 && tokens < MAX_SPEC_TOKENS; step++) {
    const at = index + (source.slice(index).match(separator)?.[0].length ?? 0)
    const next = readStep(source.slice(at), state, names, inner)
    if (next.kind === 'blocked') {
      return { end, tokens, blocked: true }
    }
    if (next.kind === 'stop') {
      break
    }
    index = at + next.length
    end = index
    if (next.kind === 'model-keyword') {
      expectsModel = true
    } else if (next.kind === 'word') {
      tokens += 1
      expectsModel = false
    }
  }
  if (expectsModel) {
    state.incomplete = true
  }
  return { end, tokens, blocked: false }
}

const SOFT_CONTINUATION =
  /^\s*[,，]\s*(?=模型|models?\b|effort\b|思考强度|推理强度|思考深度|推理深度|推理努力|(?:使用|采用|用)\s*[a-z])/i

/**
 * Reads the agent, model and effort a count names at the start of `source`, as in "claudeopus5.5",
 * "Claude opus high" or "codex 6.1sol，effort high". Null when the words name no agent or model,
 * or name something an agent is not, such as "2个codex窗口".
 */
export function readAgentDelegationTextSpec(
  source: string,
  names: AgentDelegationProviderNames
): AgentDelegationTextSpec | null {
  const state: SpecState = {
    agent: null,
    modelWords: [],
    linkStart: null,
    effort: null,
    incomplete: false
  }
  let run = readTokens(source, 0, state, names, false)
  let { end } = run
  while (!run.blocked && !state.incomplete) {
    const soft = source.slice(end).match(SOFT_CONTINUATION)?.[0]
    if (!soft) {
      break
    }
    run = readTokens(source, end + soft.length, state, names, false)
    if (run.tokens === 0) {
      state.incomplete = !run.blocked
      break
    }
    end = run.end
  }
  if (run.blocked || BLOCKED_AFTER.test(source.slice(end))) {
    return null
  }
  return state.agent || state.modelWords.length > 0 ? { ...state, end } : null
}
