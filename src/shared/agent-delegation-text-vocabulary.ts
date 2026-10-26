/** Lowercased names a person types for an agent (id, label, command), each mapped to its id. */
export type AgentDelegationProviderNames = ReadonlyMap<string, string>

// Product names people use for an agent besides its catalog id, label and command.
const PRODUCT_ALIASES: readonly (readonly [string, string])[] = [
  ['claude code', 'claude'],
  ['claude-code', 'claude'],
  ['codex cli', 'codex'],
  ['gemini cli', 'gemini']
]

const EFFORT_WORDS: ReadonlySet<string> = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])
export const CJK_EFFORT_VALUES: readonly (readonly [string, string])[] = [
  ['高', 'high'],
  ['中', 'medium'],
  ['低', 'low']
]
// Each one names an effort only with a value after it, so "思考一下" stays task text.
export const CJK_EFFORT_KEYWORDS = ['思考强度', '推理强度', '思考深度', '推理深度', '推理努力']
export const CJK_FILLERS = [
  '默认模型',
  '智能体',
  '子代理',
  '默认',
  '代理',
  '模型',
  '实例',
  '会话',
  '助手',
  '子'
]
export const CJK_LINKS = ['使用', '采用', '用']
// A count of these is a count of things to open, not of agents to authorize.
export const CJK_BLOCKERS = [
  '标签页',
  '工作树',
  '工作区',
  '窗口',
  '终端',
  '标签',
  '页面',
  '面板',
  '文件',
  '分支',
  '仓库',
  '项目',
  '进程',
  '端口',
  '账号',
  '账户',
  '版本',
  '命令'
]
export const ASCII_FILLERS: ReadonlySet<string> = new Set(
  ['agent', 'worker', 'instance', 'subagent', 'sub-agent', 'session', 'chat', 'model', 'assistant']
    .flatMap((word) => [word, `${word}s`])
    .concat(['default', 'reasoning', 'thinking'])
)
export const ASCII_BLOCKERS: ReadonlySet<string> = new Set(
  ['window', 'tab', 'terminal', 'pane', 'file', 'worktree', 'workspace', 'repo', 'project']
    .concat(['port', 'account', 'key', 'version', 'command', 'plan', 'seat', 'license'])
    .flatMap((word) => [word, `${word}s`])
    .concat(['branch', 'branches', 'process', 'processes', 'repository', 'repositories'])
)
export const ASCII_LINKS: ReadonlySet<string> = new Set(['with', 'using', 'via'])
export const ASCII_STOPS: ReadonlySet<string> = new Set(
  (
    'to for and or but then that which who so if on in at of from by into about as is are ' +
    'be will can should would could must the a an this these those it its my our your their ' +
    'me us them you i we he she they each both all one two other others while when after ' +
    'before also please plus first next now here there'
  ).split(' ')
)

/** An effort word, with spelling variants folded into the value an agent takes. */
export function agentDelegationEffortWord(word: string): string | null {
  const lower = word.toLowerCase().replace(/^(?:extra|x)-?high$/, 'xhigh')
  return EFFORT_WORDS.has(lower) ? lower : null
}

export function readAsciiToken(rest: string): { text: string; length: number } | null {
  const raw = rest.match(/^[a-z0-9][a-z0-9._/-]*/i)?.[0]
  if (!raw) {
    return null
  }
  const text = raw.replace(/[._/-]+$/, '')
  return { text, length: text.length }
}

export function startsWithAny(rest: string, words: readonly string[]): string | null {
  return words.find((word) => rest.startsWith(word)) ?? null
}

const longestFirst = new WeakMap<AgentDelegationProviderNames, string[]>()

function namesLongestFirst(names: AgentDelegationProviderNames): string[] {
  let ordered = longestFirst.get(names)
  if (!ordered) {
    ordered = [...names.keys()].sort((a, b) => b.length - a.length)
    longestFirst.set(names, ordered)
  }
  return ordered
}

/**
 * The agent a provider name at the start of `rest` names. A name glued to a model ("codex6.1sol",
 * "claude-opus-5-5") names the agent but leaves the whole word to the model; a short name never
 * glues, so "pipeline" is not Pi.
 */
export function providerAt(
  rest: string,
  names: AgentDelegationProviderNames
): { agent: string; length: number; glued: boolean } | null {
  const lower = rest.toLowerCase()
  for (const name of namesLongestFirst(names)) {
    if (!lower.startsWith(name)) {
      continue
    }
    const after = lower.slice(name.length)
    const plural = after.match(/^(?:es|s)(?![a-z0-9._/-])/)?.[0] ?? ''
    if (!/^(?:[a-z0-9]|[._/-][a-z0-9])/.test(after.slice(plural.length))) {
      return { agent: names.get(name)!, length: name.length + plural.length, glued: false }
    }
    if (name.length >= 4 && !name.includes(' ')) {
      return { agent: names.get(name)!, length: 0, glued: true }
    }
  }
  return null
}

/** The names a person may type for each agent, from the agent catalog. */
export function agentDelegationProviderNames(
  agents: readonly { id: string; label: string; cmd?: string; searchAliases?: readonly string[] }[]
): AgentDelegationProviderNames {
  const names = new Map<string, string>()
  const add = (name: string, id: string): void => {
    const key = name.trim().toLowerCase().replace(/\s+/g, ' ')
    // Each word starts with a letter, so a label like "OpenCode 2" never swallows a count.
    if (/^[a-z][a-z0-9._-]*(?: [a-z][a-z0-9._-]*)*$/.test(key) && !names.has(key)) {
      names.set(key, id)
    }
  }
  for (const agent of agents) {
    add(agent.id, agent.id)
  }
  for (const [name, id] of PRODUCT_ALIASES) {
    add(name, id)
  }
  for (const agent of agents) {
    add(agent.label, agent.id)
    if (agent.cmd && !/\s/.test(agent.cmd)) {
      add(agent.cmd, agent.id)
    }
    for (const alias of agent.searchAliases ?? []) {
      add(alias, agent.id)
    }
  }
  return names
}
