import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { AgentSessionReferenceLink } from '../../../../shared/agent-session/agent-session-reference-link'
import { buildProjectMapGraph } from './project-map-graph'
import { layoutProjectMap } from './project-map-layout'
import { collapseProjectMapGraph } from './project-map-collapse'
import { projectMapNodeReferences } from './project-map-node-references'

const workspace: DashboardWorkspace = {
  repoId: 'repo',
  worktreeId: 'main',
  repoName: 'repo',
  worktreeName: 'main',
  hostKind: 'local',
  executionHostId: 'local',
  workspaceKind: 'worktree'
}

const card = (paneKey: string, startedAt: number): DashboardCard => ({
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
  repoName: 'repo',
  worktreeName: 'main',
  startedAt,
  finishedAt: null,
  stateChangedAt: 0,
  unseen: false
})

const chat = (sessionId: string) => ({
  sessionId,
  agent: 'claude',
  executionHostId: 'local' as const
})

const link = (
  target: string,
  source: string | null,
  messageIndex = 0
): AgentSessionReferenceLink => ({
  targetSessionId: target,
  messageId: `m-${target}-${source}`,
  messageIndex,
  referenceUri: `orca-conversation://reference/${source}`,
  title: source ?? 'remote',
  source: source ? { sessionId: source, workspaceId: 'main' } : null,
  sourceMessageCount: null,
  createdAt: 0
})

// a and b are roots in one column; c was forked from a, a column to their right.
function mapWith(references: AgentSessionReferenceLink[]) {
  const snapshot: DashboardSnapshot = {
    generatedAt: 0,
    workspaces: [workspace],
    cards: [card('a', 1), card('b', 2), card('c', 3)]
  }
  const graph = buildProjectMapGraph(snapshot, 'repo', new Map(), {
    chatsByPaneKey: new Map([
      ['a', chat('claude_a')],
      ['b', chat('claude_b')],
      ['c', chat('claude_c')]
    ]),
    lineage: new Map([['claude_c', 'claude_a']]),
    references,
    titleOf: (shown) => shown.task
  })
  const layout = layoutProjectMap(graph)
  return { graph, layout, pins: projectMapNodeReferences(graph.agents, layout.wires) }
}

describe('references on the project map', () => {
  it('wires a reference from its source without moving any node', () => {
    const before = mapWith([]).layout.nodes
    const { graph, layout } = mapWith([link('claude_c', 'claude_b', 4)])
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ kind: 'reference', from: 'b', to: 'c' })
    )
    expect(layout.nodes).toEqual(before)
    expect(layout.wires.find((wire) => wire.kind === 'reference')).not.toHaveProperty('backward')
  })

  it('folds a reference from the right and one from another host into the target count', () => {
    const { pins, layout } = mapWith([link('claude_a', 'claude_c'), link('claude_a', null)])
    expect(layout.wires.find((wire) => wire.kind === 'reference')?.backward).toBe(true)
    expect(pins.get('a')).toMatchObject({ count: 2, folded: 2, pinIn: false })
  })

  it('reads a wire as live when the latest reference between two chats follows its source', () => {
    const { layout } = mapWith([
      link('claude_c', 'claude_b'),
      { ...link('claude_c', 'claude_b', 5), messageId: 'later' }
    ])
    expect(layout.wires.find((wire) => wire.kind === 'reference')?.live).toBe(true)
    const pinned = mapWith([{ ...link('claude_c', 'claude_b'), sourceMessageCount: 9 }])
    expect(pinned.layout.wires.find((wire) => wire.kind === 'reference')).not.toHaveProperty('live')
  })

  it('arcs a reference between chats in one column through the gutter on their right', () => {
    const { pins, layout } = mapWith([link('claude_b', 'claude_a')])
    const wire = layout.wires.find((candidate) => candidate.kind === 'reference')
    expect(wire).toMatchObject({ from: 'a', to: 'b', side: true })
    expect(pins.get('b')).toMatchObject({ count: 1, folded: 0, pinInRight: true })
  })

  it('keeps the live mark when a stack folds the graph', () => {
    const { graph } = mapWith([link('claude_c', 'claude_b')])
    const edge = collapseProjectMapGraph(graph, new Set()).graph.edges.find(
      (candidate) => candidate.kind === 'reference'
    )
    expect(edge).toMatchObject({ from: 'b', to: 'c', live: true })
  })

  it('draws a closed chat that only a reference connects', () => {
    const snapshot: DashboardSnapshot = {
      generatedAt: 0,
      workspaces: [workspace],
      cards: [card('a', 1)]
    }
    const graph = buildProjectMapGraph(snapshot, 'repo', new Map(), {
      chatsByPaneKey: new Map([['a', chat('claude_a')]]),
      lineage: new Map(),
      history: new Map([
        ['claude_gone', { ...chat('claude_gone'), workspaceId: 'main', title: 'Gone' }]
      ]),
      references: [link('claude_a', 'claude_gone')],
      titleOf: (shown) => shown.task
    })
    const closed = [...graph.agents.values()].find((agent) => agent.history)
    expect(closed?.chat?.sessionId).toBe('claude_gone')
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ kind: 'reference', to: 'a', from: closed?.card.paneKey })
    )
  })
})
