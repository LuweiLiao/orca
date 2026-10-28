import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardCardDotState,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import { buildProjectMapGraph } from './project-map-graph'
import { PROJECT_MAP_HISTORY_PANE_PREFIX } from './project-map-closed-chats'
import { layoutProjectMap } from './project-map-layout'
import { collapseProjectMapGraph, PROJECT_MAP_GROUP_PREFIX } from './project-map-collapse'

const workspace: DashboardWorkspace = {
  repoId: 'repo',
  worktreeId: 'main',
  repoName: 'repo',
  worktreeName: 'main',
  hostKind: 'local',
  executionHostId: 'local',
  workspaceKind: 'worktree'
}

function card(
  paneKey: string,
  startedAt: number,
  parentPaneKey?: string,
  dotState: DashboardCardDotState = 'done'
): DashboardCard {
  return {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket: 'done',
    dotState,
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
    unseen: true
  }
}

const chat = (sessionId: string) => ({
  sessionId,
  agent: 'claude',
  executionHostId: 'local' as const
})

function forked(child: string, source: string): AgentSessionLineageEntry {
  return {
    childSessionId: child,
    sourceSessionId: source,
    originSessionId: source,
    mode: 'native',
    cut: { journalItemId: 'i', journalEpoch: 'e', journalSequence: 3, messageCount: 3 },
    sourceProvider: 'claude',
    createdAt: 0
  }
}

// lead delegates w1..w5; w1 delegates g1; w2 was forked into a person's own chat, mine.
function fleet() {
  const snapshot: DashboardSnapshot = {
    generatedAt: 0,
    workspaces: [workspace],
    cards: [
      card('lead', 1),
      card('w1', 2, 'lead', 'working'),
      card('w2', 3, 'lead', 'waiting'),
      card('w3', 4, 'lead'),
      card('w4', 5, 'lead'),
      card('w5', 6, 'lead'),
      card('g1', 7, 'w1'),
      card('mine', 8)
    ]
  }
  return buildProjectMapGraph(snapshot, 'repo', new Map(), {
    chatsByPaneKey: new Map([
      ['w2', chat('claude_w2')],
      ['mine', chat('claude_mine')]
    ]),
    lineage: new Map([['claude_mine', forked('claude_mine', 'claude_w2')]]),
    titleOf: (shown) => shown.task
  })
}

describe('stacking a busy parent', () => {
  it("folds a parent's delegated chats, and theirs, into one stack the layout places once", () => {
    const view = collapseProjectMapGraph(fleet(), new Set())
    const id = `${PROJECT_MAP_GROUP_PREFIX}lead`
    expect(view.groups.get(id)).toMatchObject({
      childPaneKeys: ['w1', 'w3', 'w4', 'w5'],
      memberPaneKeys: ['w1', 'g1', 'w3', 'w4', 'w5'],
      counts: { working: 1, waiting: 0, settled: 4 }
    })
    const layout = layoutProjectMap(view.graph)
    expect(layout.nodes.has(id)).toBe(true)
    // The worker the person forked from stays out of the stack, so the fork leaves from it.
    expect([...layout.nodes.keys()].filter((key) => key.startsWith('w'))).toEqual(['w2'])
    expect(layout.nodes.has('mine')).toBe(true)
    expect(view.graph.edges).toEqual(
      expect.arrayContaining([
        { kind: 'delegate', from: 'lead', to: id },
        { kind: 'delegate', from: 'lead', to: 'w2' },
        { kind: 'handoff', from: 'w2', to: 'mine' }
      ])
    )
    expect(view.graph.edges.some((edge) => edge.from === id && edge.kind === 'handoff')).toBe(false)
    expect(view.groupOf.get('g1')).toBe(id)
  })

  it('keeps the layout still when a hidden chat changes state', () => {
    const before = layoutProjectMap(collapseProjectMapGraph(fleet(), new Set()).graph)
    const graph = fleet()
    graph.agents.get('w3')!.card.dotState = 'working'
    const after = collapseProjectMapGraph(graph, new Set())
    expect(after.groups.get(`${PROJECT_MAP_GROUP_PREFIX}lead`)?.counts.working).toBe(2)
    expect(layoutProjectMap(after.graph).nodes).toEqual(before.nodes)
  })

  it('draws an expanded parent as before, and leaves a small fleet alone', () => {
    const graph = fleet()
    const view = collapseProjectMapGraph(graph, new Set(['lead']))
    expect(view.graph).toBe(graph)
    expect(view.collapsible.has('lead')).toBe(true)
    expect(view.collapsible.has('w1')).toBe(false)
  })
})

describe('closed chats on the map', () => {
  it("draws a fork's closed source as a history node in its workspace, wired to the child", () => {
    const graph = buildProjectMapGraph(
      { generatedAt: 0, workspaces: [workspace], cards: [card('child', 3)] },
      'repo',
      new Map(),
      {
        chatsByPaneKey: new Map([['child', chat('claude_child')]]),
        lineage: new Map([['claude_child', forked('claude_child', 'claude_gone')]]),
        history: new Map([
          ['claude_gone', { ...chat('claude_gone'), workspaceId: 'main', title: 'Plan the map' }],
          ['claude_child', { ...chat('claude_child'), workspaceId: 'main', title: 'child' }]
        ]),
        titleOf: (shown) => shown.task
      }
    )
    const ghostKey = `${PROJECT_MAP_HISTORY_PANE_PREFIX}claude_gone`
    expect(graph.agents.get(ghostKey)).toMatchObject({
      history: true,
      chat: { sessionId: 'claude_gone' },
      card: { conversationName: 'Plan the map', worktreeId: 'main' }
    })
    expect(graph.agents.has(`${PROJECT_MAP_HISTORY_PANE_PREFIX}claude_child`)).toBe(false)
    expect(graph.edges).toEqual([{ kind: 'handoff', from: ghostKey, to: 'child' }])
    expect(graph.agents.get('child')).toMatchObject({
      hasUnresolvedParent: false,
      fork: { sourceTitle: 'Plan the map' }
    })
  })
})
