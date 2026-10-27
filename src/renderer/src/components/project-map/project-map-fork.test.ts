import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import { buildProjectMapGraph } from './project-map-graph'
import { layoutProjectMap, PROJECT_MAP_NODE } from './project-map-layout'
import { projectMapForkSources } from './project-map-fork-sources'
import type { ProjectMapChat } from './project-map-lineage'

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

const chat = (sessionId: string): ProjectMapChat => ({
  sessionId,
  agent: 'claude',
  executionHostId: 'local'
})

function forked(
  child: string,
  source: string,
  mode: AgentSessionLineageEntry['mode'] = 'native'
): AgentSessionLineageEntry {
  return {
    childSessionId: child,
    sourceSessionId: source,
    originSessionId: source,
    mode,
    cut: { journalItemId: 'i', journalEpoch: 'e', journalSequence: 3, messageCount: 3 },
    sourceProvider: 'claude',
    createdAt: 0
  }
}

// root ─fork→ mid ─fork→ leaf, and mid ─handoff→ other (a Codex child fed by text).
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
    ['claude_mid_chat', forked('claude_mid_chat', 'claude_root_chat')],
    ['claude_leaf_chat', forked('claude_leaf_chat', 'claude_mid_chat')],
    ['codex_other_chat', forked('codex_other_chat', 'claude_mid_chat', 'transcript')]
  ])
  return buildProjectMapGraph(snapshot, 'repo', new Map(), {
    chatsByPaneKey: chats,
    lineage,
    titleOf: (shown) => shown.task
  })
}

describe('forks on the project map', () => {
  it('draws each fork from its source, solid for a copy and dashed for a hand-off', () => {
    const graph = forkTree()
    expect(graph.edges).toEqual([
      { kind: 'fork', from: 'root', to: 'mid' },
      { kind: 'fork', from: 'mid', to: 'leaf' },
      { kind: 'handoff', from: 'mid', to: 'other' }
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
        lineage: new Map([['claude_leaf_chat', forked('claude_leaf_chat', 'claude_gone_chat')]]),
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
        lineage: new Map([['claude_child_chat', forked('claude_child_chat', 'claude_root_chat')]]),
        titleOf: (shown) => shown.task
      }
    )
    expect(graph.edges).toEqual([{ kind: 'fork', from: 'root', to: 'child' }])
  })

  it('keeps a hand-off whose earliest messages were left out marked with how many it carried', () => {
    const graph = buildProjectMapGraph(
      { generatedAt: 0, workspaces: [workspace], cards: [card('root', 1), card('child', 2)] },
      'repo',
      new Map(),
      {
        chatsByPaneKey: new Map([
          ['root', chat('claude_root_chat')],
          ['child', { ...chat('codex_child_chat'), agent: 'codex' }]
        ]),
        lineage: new Map([
          [
            'codex_child_chat',
            { ...forked('codex_child_chat', 'claude_root_chat', 'transcript'), handedOverCount: 2 }
          ]
        ]),
        titleOf: (shown) => shown.task
      }
    )
    expect(graph.agents.get('child')?.fork).toMatchObject({
      messageCount: 3,
      entry: { handedOverCount: 2 }
    })
  })

  it('offers the clicked chat and its ancestors, cutting each ancestor where it forked the next', () => {
    const graph = forkTree()
    const sources = projectMapForkSources(graph.agents.get('leaf')!, graph.agents)
    expect(sources.map(({ agent, depth, cut }) => [agent.card.paneKey, depth, cut])).toEqual([
      ['leaf', 0, { kind: 'latest' }],
      ['mid', 1, { kind: 'fork-point', childSessionId: 'claude_leaf_chat' }],
      ['root', 2, { kind: 'fork-point', childSessionId: 'claude_mid_chat' }]
    ])
  })
})
