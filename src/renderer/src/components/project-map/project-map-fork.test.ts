import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentSessionConversationNames } from '../../../../shared/agent-session/conversation-naming/agent-session-conversation-names'
import { buildProjectMapGraph } from './project-map-graph'
import { layoutProjectMap, PROJECT_MAP_NODE } from './project-map-layout'
import { projectMapForkSources, projectMapLatestForkItemId } from './project-map-fork-sources'
import { projectMapLineageFromFeeds, type ProjectMapChat } from './project-map-lineage'
import type { AgentSessionStatusSummary } from '../../../../shared/agent-session/agent-session-wire'

const workspace: DashboardWorkspace = {
  repoId: 'repo',
  worktreeId: 'main',
  repoName: 'repo',
  worktreeName: 'main',
  hostKind: 'local',
  executionHostId: 'local',
  workspaceKind: 'worktree'
}

function card(paneKey: string, startedAt: number, parentPaneKey?: string): DashboardCard {
  return {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket: 'done',
    dotState: 'done',
    task: paneKey,
    repoId: 'repo',
    worktreeId: 'main',
    tabId: `tab-${paneKey}`,
    leafId: null,
    ...(parentPaneKey ? { parentPaneKey } : {}),
    repoName: 'repo',
    worktreeName: 'main',
    startedAt,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false
  }
}

const statusOf = (sessionId: string): AgentSessionStatusSummary => ({
  sessionId,
  workspaceId: 'main',
  agent: 'claude',
  status: null,
  latestPrompt: '',
  updatedAt: 0
})

const chat = (sessionId: string): ProjectMapChat => ({
  sessionId,
  agent: 'claude',
  executionHostId: 'local'
})

// root ─fork→ mid ─fork→ leaf; other is a Codex chat forked from mid by its own host.
function forkTree() {
  const snapshot: DashboardSnapshot = {
    generatedAt: 0,
    workspaces: [workspace],
    cards: [card('root', 1), card('mid', 2), card('leaf', 3), card('other', 4)]
  }
  const chats = new Map([
    ['root', chat('claude_root_chat')],
    ['mid', chat('claude_mid_chat')],
    ['leaf', chat('claude_leaf_chat')],
    ['other', { ...chat('codex_other_chat'), agent: 'codex' }]
  ])
  const lineage = new Map([
    ['claude_mid_chat', 'claude_root_chat'],
    ['claude_leaf_chat', 'claude_mid_chat'],
    ['codex_other_chat', 'claude_mid_chat']
  ])
  return buildProjectMapGraph(snapshot, 'repo', new Map(), {
    chatsByPaneKey: chats,
    lineage,
    titleOf: (shown) => shown.task
  })
}

describe('forks on the project map', () => {
  it('draws each fork from the source its host names', () => {
    const graph = forkTree()
    expect(graph.edges).toEqual([
      { kind: 'fork', from: 'root', to: 'mid' },
      { kind: 'fork', from: 'mid', to: 'leaf' },
      { kind: 'fork', from: 'mid', to: 'other' }
    ])
    expect(graph.agents.get('leaf')?.fork?.sourceTitle).toBe('mid')
    const layout = layoutProjectMap(graph)
    // Fork wires attach to the header pins, a column to the right of the source.
    const wire = layout.wires.find((candidate) => candidate.to === 'leaf')
    const [, y0] = (wire?.path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    expect(y0).toBe((layout.nodes.get('mid')?.y ?? 0) + PROJECT_MAP_NODE.headerPinOffsetY)
    expect(layout.nodes.get('leaf')!.x).toBeGreaterThan(layout.nodes.get('mid')!.x)
  })

  it('keeps a fork whose source chat was closed, marked as unresolved instead of dropped', () => {
    const graph = buildProjectMapGraph(
      { generatedAt: 0, workspaces: [workspace], cards: [card('leaf', 3)] },
      'repo',
      new Map(),
      {
        chatsByPaneKey: new Map([['leaf', chat('claude_leaf_chat')]]),
        lineage: new Map([['claude_leaf_chat', 'claude_gone_chat']]),
        titleOf: (shown) => shown.task
      }
    )
    expect(graph.edges).toEqual([])
    expect(graph.agents.get('leaf')).toMatchObject({ hasUnresolvedParent: true })
    expect(graph.agents.get('leaf')?.fork?.sourceTitle).toBeNull()
  })

  it('wires a fork to the pane that opened its source first when the source is split into two', () => {
    const graph = buildProjectMapGraph(
      {
        generatedAt: 0,
        workspaces: [workspace],
        cards: [card('child', 3), card('split', 2), card('root', 1)]
      },
      'repo',
      new Map(),
      {
        chatsByPaneKey: new Map([
          ['root', chat('claude_root_chat')],
          ['split', chat('claude_root_chat')],
          ['child', chat('claude_child_chat')]
        ]),
        lineage: new Map([['claude_child_chat', 'claude_root_chat']]),
        titleOf: (shown) => shown.task
      }
    )
    expect(graph.edges).toEqual([{ kind: 'fork', from: 'root', to: 'child' }])
  })

  it('offers the clicked chat and its ancestors of the same agent on the same host', () => {
    const graph = forkTree()
    const sources = projectMapForkSources(graph.agents.get('leaf')!, graph.agents)
    expect(sources.map(({ agent, depth }) => [agent.card.paneKey, depth])).toEqual([
      ['leaf', 0],
      ['mid', 1],
      ['root', 2]
    ])
    // A Codex chat cannot continue a Claude conversation natively, so its Claude parents are not offered.
    expect(
      projectMapForkSources(graph.agents.get('other')!, graph.agents).map((source) => source.depth)
    ).toEqual([0])
  })

  it('reads fork sources from whichever host names the chat, through closed chats', () => {
    const names: AgentSessionConversationNames = new Map(
      [
        ['leaf', 'gone'],
        ['gone', 'root']
      ].map(([child, source]) => [
        child!,
        {
          sessionId: child!,
          conversationName: child === 'gone' ? 'Old plan' : null,
          forkedFrom: { sessionId: source! }
        }
      ])
    )
    const { lineage, history } = projectMapLineageFromFeeds(
      ['leaf', 'root'],
      [
        { executionHostId: null, names: new Map(), statuses: new Map() },
        {
          executionHostId: 'local',
          names,
          statuses: new Map([['gone', statusOf('gone')]])
        }
      ]
    )
    expect([...lineage]).toEqual([
      ['leaf', 'gone'],
      ['gone', 'root']
    ])
    expect(history.get('gone')).toEqual({
      sessionId: 'gone',
      agent: 'claude',
      executionHostId: 'local',
      workspaceId: 'main',
      title: 'Old plan'
    })
  })

  it('forks through the newest response, and not through a prompt', () => {
    const item = (
      itemId: string,
      sequence: number,
      role: 'assistant' | 'user'
    ): AgentJournalRenderItem => ({
      itemId,
      revision: 1,
      sequence,
      observedAt: sequence,
      body: { kind: 'message', role, blocks: [{ type: 'text', text: itemId }] }
    })
    expect(
      projectMapLatestForkItemId([item('r1', 1, 'assistant'), item('r2', 2, 'assistant')])
    ).toBe('r2')
    expect(projectMapLatestForkItemId([item('u1', 1, 'user')])).toBeUndefined()
  })
})
