import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import type { AgentSessionReferenceLink } from '../../../../shared/agent-session-reference-link'
import { buildProjectMapGraph } from './project-map-graph'
import { layoutProjectMap } from './project-map-layout'
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

const forked: AgentSessionLineageEntry = {
  childSessionId: 'claude_c',
  sourceSessionId: 'claude_a',
  originSessionId: 'claude_a',
  mode: 'native',
  cut: { journalItemId: 'i', journalEpoch: 'e', journalSequence: 1, messageCount: 1 },
  sourceProvider: 'claude',
  createdAt: 0
}

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
    lineage: new Map([['claude_c', forked]]),
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
    expect(graph.edges).toContainEqual({ kind: 'reference', from: 'b', to: 'c' })
    expect(layout.nodes).toEqual(before)
    expect(layout.wires.find((wire) => wire.kind === 'reference')).not.toHaveProperty('backward')
  })

  it('folds a reference from the right and one from another host into the target count', () => {
    const { pins, layout } = mapWith([link('claude_a', 'claude_c'), link('claude_a', null)])
    expect(layout.wires.find((wire) => wire.kind === 'reference')?.backward).toBe(true)
    expect(pins.get('a')).toMatchObject({ count: 2, folded: 2, pinIn: false })
  })

  it('arcs a reference between chats in one column through the gutter on their right', () => {
    const { pins, layout } = mapWith([link('claude_b', 'claude_a')])
    const wire = layout.wires.find((candidate) => candidate.kind === 'reference')
    expect(wire).toMatchObject({ from: 'a', to: 'b', side: true })
    expect(pins.get('b')).toMatchObject({ count: 1, folded: 0, pinInRight: true })
  })
})
