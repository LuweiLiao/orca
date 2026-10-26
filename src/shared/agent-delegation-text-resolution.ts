import type { OrchestrationAgentSelection } from './native-chat-orchestration-reference'
import type { AgentDelegationTextGroup } from './agent-delegation-text-request'
import { agentDelegationEffortWord } from './agent-delegation-text-vocabulary'

export type AgentDelegationCatalogModel = {
  id: string
  label: string
  efforts?: readonly { value: string; label: string }[]
}

/** Per agent: absent, not asked for yet; null, loading; empty, the host lists no models. */
export type AgentDelegationCatalogs = Readonly<
  Record<string, readonly AgentDelegationCatalogModel[] | null>
>

export type AgentDelegationUnresolved =
  | { reason: 'agent-unavailable'; agent: string }
  | { reason: 'model-not-found' | 'model-ambiguous'; agent: string | null; query: string }
  | { reason: 'effort-needs-model'; agent: string; effort: string }
  | { reason: 'effort-not-offered'; agent: string; model: string; effort: string }
  | { reason: 'incomplete' }

export type AgentDelegationTextResolution =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'ready'; cards: OrchestrationAgentSelection[] }
  | { kind: 'unresolved'; detail: AgentDelegationUnresolved }

type ModelPick = { model: AgentDelegationCatalogModel | null; effort: string | null }
type Ranked = {
  models: (AgentDelegationCatalogModel | null)[]
  rank: number
  effort: string | null
}

// Family words people drop or add ("opus 5.5" for claude-opus-5-5, "6.1sol" for gpt-6.1-sol).
const BRANDS = ['claude', 'gpt', 'gemini', 'grok']

/** The agents whose model catalogs the groups need: every available one for a bare model name. */
export function agentDelegationCatalogAgents(
  groups: readonly AgentDelegationTextGroup[],
  available: ReadonlySet<string> | null
): string[] {
  const agents = new Set<string>()
  for (const group of groups) {
    if (group.incomplete) {
      continue
    }
    if (group.agent) {
      if (group.modelWords.length + group.linkedWords.length > 0 || group.effort) {
        agents.add(group.agent)
      }
    } else {
      for (const agent of available ?? []) {
        agents.add(agent)
      }
    }
  }
  return available ? [...agents].filter((agent) => available.has(agent)) : []
}

/** Identity of a parsed request: the composer forgets a dismissal once the request changes. */
export function agentDelegationTextSignature(
  groups: readonly AgentDelegationTextGroup[]
): string | null {
  return groups.length > 0 ? JSON.stringify(groups) : null
}

/**
 * Turns parsed requests into the cards a send would carry. Every request must resolve to exactly
 * one agent, model and effort the host lists; anything less makes no cards, so a partial reading
 * never authorizes a smaller or different team than the person asked for.
 */
export function resolveAgentDelegationText(
  groups: readonly AgentDelegationTextGroup[],
  available: ReadonlySet<string> | null,
  labelOf: (agent: string) => string,
  catalogs: AgentDelegationCatalogs
): AgentDelegationTextResolution {
  if (groups.length === 0) {
    return { kind: 'none' }
  }
  if (!available) {
    return { kind: 'pending' }
  }
  const cards: OrchestrationAgentSelection[] = []
  let namedPending = false
  let modelOnlyPending = false
  for (const group of groups) {
    if (group.incomplete) {
      return { kind: 'unresolved', detail: { reason: 'incomplete' } }
    }
    const resolved = group.agent
      ? resolveNamed(group, group.agent, available, catalogs)
      : resolveModelOnly(group, available, catalogs)
    if (resolved === 'pending') {
      namedPending ||= group.agent !== null
      modelOnlyPending ||= group.agent === null
    } else if (resolved !== 'drop' && 'reason' in resolved) {
      return { kind: 'unresolved', detail: resolved }
    } else if (resolved !== 'drop') {
      cards.push(cardOf(group, resolved.agent, labelOf(resolved.agent), resolved.pick))
    }
  }
  // A bare "2个sonnet" may be no request at all, so it shows nothing until its catalogs load.
  if (namedPending || (modelOnlyPending && cards.length > 0)) {
    return { kind: 'pending' }
  }
  return modelOnlyPending || cards.length === 0 ? { kind: 'none' } : { kind: 'ready', cards }
}

type Resolved = 'pending' | 'drop' | AgentDelegationUnresolved | { agent: string; pick: ModelPick }

function resolveNamed(
  group: AgentDelegationTextGroup,
  agent: string,
  available: ReadonlySet<string>,
  catalogs: AgentDelegationCatalogs
): Resolved {
  if (!available.has(agent)) {
    return { reason: 'agent-unavailable', agent }
  }
  if (group.modelWords.length + group.linkedWords.length === 0 && !group.effort) {
    return { agent, pick: { model: null, effort: null } }
  }
  const catalog = catalogs[agent]
  if (catalog === undefined || catalog === null) {
    return 'pending'
  }
  const ranked = rankModels(group, agent, catalog, true)
  if (!ranked || ranked.models.length !== 1) {
    return {
      reason: ranked ? 'model-ambiguous' : 'model-not-found',
      agent,
      query: [...group.modelWords, ...group.linkedWords].join(' ')
    }
  }
  return withOfferedEffort(agent, { model: ranked.models[0] ?? null, effort: ranked.effort })
}

function resolveModelOnly(
  group: AgentDelegationTextGroup,
  available: ReadonlySet<string>,
  catalogs: AgentDelegationCatalogs
): Resolved {
  let pending = false
  let best: { agent: string; pick: ModelPick }[] = []
  let bestRank = Infinity
  for (const agent of available) {
    const catalog = catalogs[agent]
    if (catalog === undefined || catalog === null) {
      pending = true
      continue
    }
    const ranked = rankModels(group, agent, catalog, false)
    if (!ranked || ranked.rank > bestRank) {
      continue
    }
    const found = ranked.models.flatMap((model) =>
      model ? [{ agent, pick: { model, effort: ranked.effort } }] : []
    )
    best = ranked.rank < bestRank ? found : [...best, ...found]
    bestRank = ranked.rank
  }
  if (pending) {
    return 'pending'
  }
  const query = group.modelWords.join(' ')
  const only = best.length === 1 ? best[0] : undefined
  if (!only) {
    return best.length > 1
      ? { reason: 'model-ambiguous', agent: null, query }
      : group.chained
        ? { reason: 'model-not-found', agent: null, query }
        : 'drop'
  }
  return withOfferedEffort(only.agent, only.pick)
}

function withOfferedEffort(agent: string, pick: ModelPick): Resolved {
  const { model, effort } = pick
  if (!effort) {
    return { agent, pick }
  }
  if (!model) {
    return { reason: 'effort-needs-model', agent, effort }
  }
  const offered = model.efforts?.find(
    (choice) =>
      choice.value.toLowerCase() === effort ||
      agentDelegationEffortWord(choice.label.replace(/\s+/g, '-')) === effort
  )
  return offered
    ? { agent, pick: { model, effort: offered.value } }
    : { reason: 'effort-not-offered', agent, model: model.label, effort }
}

/**
 * The best-named models in one catalog: the words with any linked ones, then without a trailing
 * effort word ("opus high"), then the agent's own words alone when the linked ones name nothing.
 */
function rankModels(
  group: AgentDelegationTextGroup,
  agent: string,
  catalog: readonly AgentDelegationCatalogModel[],
  allowDefault: boolean
): Ranked | null {
  for (const attempt of modelAttempts(group)) {
    if (attempt.words.length === 0) {
      if (allowDefault) {
        return { models: [null], rank: -1, effort: attempt.effort }
      }
      continue
    }
    const match = matchModels(attempt.words.join(' '), agent, catalog)
    if (match) {
      return { ...match, effort: attempt.effort }
    }
  }
  return null
}

function modelAttempts(
  group: AgentDelegationTextGroup
): { words: readonly string[]; effort: string | null }[] {
  const withTrailingEffort = (words: readonly string[]) => {
    const trailing =
      !group.effort && words.length > 0 ? agentDelegationEffortWord(words.at(-1)!) : null
    return [
      { words, effort: group.effort },
      ...(trailing ? [{ words: words.slice(0, -1), effort: trailing }] : [])
    ]
  }
  return [
    ...withTrailingEffort([...group.modelWords, ...group.linkedWords]),
    ...(group.linkedWords.length > 0 ? withTrailingEffort(group.modelWords) : [])
  ]
}

function matchModels(
  query: string,
  agent: string,
  catalog: readonly AgentDelegationCatalogModel[]
): { models: AgentDelegationCatalogModel[]; rank: number } | null {
  const brands = [...BRANDS, ...(agent.length >= 4 ? [agent.toLowerCase()] : [])].sort(
    (a, b) => b.length - a.length
  )
  const wanted = formsOf(query, brands)
  let models: AgentDelegationCatalogModel[] = []
  let best = Infinity
  for (const model of catalog) {
    const rank = Math.min(
      rankOf(wanted, formsOf(model.id, brands)),
      rankOf(wanted, formsOf(model.label, brands))
    )
    if (rank < best) {
      models = [model]
      best = rank
    } else if (rank === best && rank !== Infinity) {
      models.push(model)
    }
  }
  return best === Infinity ? null : { models, rank: best }
}

/** Ever looser spellings of a model name, compared level by level and never across levels. */
function formsOf(text: string, brands: readonly string[]): string[] {
  const raw = text.toLowerCase().replace(/[\s_-]+/g, '')
  const brandless = stripBrand(raw, brands)
  const pathless = stripBrand(raw.slice(raw.lastIndexOf('/') + 1), brands)
  const dotless = (form: string): string => form.replace(/[./]/g, '')
  return [raw, brandless, pathless, dotless(raw), dotless(brandless), dotless(pathless)]
}

function stripBrand(form: string, brands: readonly string[]): string {
  const brand = brands.find((name) => form.startsWith(name) && form.length > name.length)
  return brand ? form.slice(brand.length) : form
}

function rankOf(wanted: readonly string[], candidate: readonly string[]): number {
  const level = wanted.findIndex((form, index) => form !== '' && form === candidate[index])
  return level === -1 ? Infinity : level
}

function cardOf(
  group: AgentDelegationTextGroup,
  agent: string,
  label: string,
  pick: ModelPick
): OrchestrationAgentSelection {
  return {
    agent,
    label,
    count: group.count,
    task: '',
    ...(pick.model ? { model: { id: pick.model.id, label: pick.model.label } } : {}),
    ...(pick.effort ? { effort: pick.effort } : {})
  }
}
