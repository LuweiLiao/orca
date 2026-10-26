import { expect, it } from 'vitest'
import { parseAgentDelegationTextRequest } from './agent-delegation-text-request'
import {
  agentDelegationCatalogAgents,
  resolveAgentDelegationText,
  type AgentDelegationCatalogs,
  type AgentDelegationTextResolution
} from './agent-delegation-text-resolution'
import { agentDelegationProviderNames } from './agent-delegation-text-vocabulary'

const names = agentDelegationProviderNames([
  { id: 'claude', label: 'Claude', cmd: 'claude' },
  { id: 'codex', label: 'Codex', cmd: 'codex' },
  { id: 'opencode', label: 'OpenCode', cmd: 'opencode' },
  { id: 'grok', label: 'Grok', cmd: 'grok' }
])
const efforts = ['low', 'medium', 'high'].map((value) => ({ value, label: value }))
// The model lists these hosts report: Claude's ids are aliases, its labels the full names.
const catalogs: AgentDelegationCatalogs = {
  claude: [
    { id: 'opus', label: 'claude-opus-5-5', efforts },
    { id: 'fable', label: 'Fable' },
    { id: 'sonnet', label: 'claude-sonnet-5', efforts }
  ],
  codex: ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5', 'codex-auto-review'].map((id) => ({
    id,
    label: id,
    efforts
  })),
  opencode: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5'].map((id) => ({ id, label: id }))
}
const available = new Set(['claude', 'codex', 'opencode'])

function resolve(text: string, loaded: AgentDelegationCatalogs = catalogs) {
  const groups = parseAgentDelegationTextRequest(text, names)
  return resolveAgentDelegationText(groups, available, (agent) => agent, loaded)
}

function teams(text: string): string[] | AgentDelegationTextResolution {
  const resolution = resolve(text)
  return resolution.kind === 'ready'
    ? resolution.cards.map(
        (card) =>
          `${card.count} ${card.agent} ${card.model?.id ?? 'default'}${card.effort ? ` ${card.effort}` : ''}`
      )
    : resolution
}

it.each([
  [
    '你看看这个功能怎么样、是不是很有意义、你分析下、创建2个claudeopus5.5和2个codex 6.1sol分析下、先不动代码',
    ['2 claude opus', '2 codex gpt-6.1-sol']
  ],
  ['能清晰看到是怎么派生和继承的，再编排2个sonnet分析一下', ['2 claude sonnet']],
  ['编排 2 个 Claude，模型 opus，effort high，分析该实现', ['2 claude opus high']],
  [
    'Spawn 2 claude opus high agents to review the parser, then 1 codex gpt-5.5 to fix it.',
    ['2 claude opus high', '1 codex gpt-5.5']
  ],
  ['用两个claude（opus，负责前端）和一个codex', ['2 claude opus', '1 codex default']],
  ['创建2个claude分析下为什么崩溃？', ['2 claude default']],
  ['帮我开3个codex：一个改前端、一个改后端、一个写测试', ['3 codex default']],
  ['用2个gpt-6.1-sol', ['2 codex gpt-6.1-sol']]
])('reads %j as exactly the team the host can start', (text, expected) => {
  expect(teams(text)).toEqual(expected)
})

it.each([
  '先别开2个claude',
  "Don't spawn 2 claude agents",
  '要不要用2个codex分析下？',
  'Should we spawn 2 codex agents?',
  '创建2个claude分析下，可以吗？',
  '我之前用2个claude分析过',
  '比如开10个agent的时候',
  '开2个codex窗口',
  '打开2个claude',
  '用2个GPU跑训练',
  'use 2 spaces for indentation',
  '用户明确仅授权你这 1 个 Claude，model=opus，effort=high',
  '例子：“创建2个claude分析下”',
  '> 创建2个claude分析下',
  '```\n创建2个claude分析下\n```'
])('reads %j as talk about agents, not a request', (text) => {
  expect(resolve(text)).toEqual({ kind: 'none' })
})

it.each([
  ['创建2个claude和codex对比一下', { reason: 'incomplete' }],
  ['之前那2个codex太慢了，创建2个claude分析下', { reason: 'incomplete' }],
  ['创建2个claude，如果需要再加1个codex', { reason: 'incomplete' }],
  ['创建2个claude，模型分别是opus和sonnet', { reason: 'incomplete' }],
  ['创建2个claude opus5分析下', { reason: 'model-not-found', agent: 'claude', query: 'opus5' }],
  ['创建2个codex effort high', { reason: 'effort-needs-model', agent: 'codex', effort: 'high' }],
  [
    '创建2个claude fable high',
    { reason: 'effort-not-offered', agent: 'claude', model: 'Fable', effort: 'high' }
  ],
  ['创建2个grok分析', { reason: 'agent-unavailable', agent: 'grok' }]
])('makes no cards from %j, and says why', (text, detail) => {
  expect(resolve(text)).toEqual({ kind: 'unresolved', detail })
})

it('waits for the named agent model list, and shows a bare model name only once lists load', () => {
  const named = parseAgentDelegationTextRequest('创建2个claude opus分析', names)
  expect(agentDelegationCatalogAgents(named, available)).toEqual(['claude'])
  expect(resolve('创建2个claude opus分析', { claude: null })).toEqual({ kind: 'pending' })

  const bare = parseAgentDelegationTextRequest('再编排2个sonnet分析一下', names)
  expect(agentDelegationCatalogAgents(bare, available)).toEqual(['claude', 'codex', 'opencode'])
  expect(resolve('再编排2个sonnet分析一下', { claude: catalogs.claude! })).toEqual({ kind: 'none' })
})
