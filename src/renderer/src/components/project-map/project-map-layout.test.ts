import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import { buildProjectMapGraph } from './project-map-graph'
import { layoutProjectMap } from './project-map-layout'

function workspace(id: string, parent?: string, repoId = 'repo'): DashboardWorkspace {
  return {
    repoId,
    worktreeId: id,
    repoName: repoId,
    worktreeName: id,
    ...(parent ? { parentWorktreeId: parent } : {}),
    hostKind: 'local',
    executionHostId: 'local',
    workspaceKind: 'worktree'
  }
}

function card(paneKey: string, worktreeId: string, parentPaneKey?: string): DashboardCard {
  return {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket: 'done',
    dotState: 'done',
    task: paneKey,
    repoId: 'repo',
    worktreeId,
    tabId: `tab-${paneKey}`,
    leafId: null,
    ...(parentPaneKey ? { parentPaneKey } : {}),
    repoName: 'repo',
    worktreeName: worktreeId,
    startedAt: Number(paneKey.replace(/\D/g, '')) || 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false
  }
}

function snapshot(workspaces: DashboardWorkspace[], cards: DashboardCard[]): DashboardSnapshot {
  return { generatedAt: 0, cards, workspaces }
}

describe('project map', () => {
  it('links derivation and delegation inside one project, across workspaces', () => {
    const graph = buildProjectMapGraph(
      snapshot(
        [workspace('main'), workspace('feature', 'main'), workspace('other', 'main', 'repo-2')],
        [card('a1', 'main'), card('a2', 'feature', 'a1'), card('a3', 'feature', 'gone')]
      ),
      'repo'
    )
    expect(graph.edges).toEqual([
      { kind: 'derive', from: 'main', to: 'feature' },
      { kind: 'delegate', from: 'a1', to: 'a2' }
    ])
    expect(graph.workspaces.has('other')).toBe(false)
    expect(graph.agents.get('a3')?.hasUnresolvedParent).toBe(true)
  })

  it('draws a chat once, in the workspace that owns it', () => {
    const sessions = new Map([
      [
        'a2',
        {
          sessionId: 's2',
          worktreeId: 'child',
          executionHostId: 'local' as const,
          provider: 'claude',
          createdAt: 0
        }
      ]
    ])
    // The sidebar lists the worker under its coordinator's workspace too.
    const graph = buildProjectMapGraph(
      snapshot(
        [workspace('main'), workspace('child', 'main')],
        [card('a1', 'main'), card('a2', 'main', 'a1'), card('a2', 'child', 'a1')]
      ),
      'repo',
      sessions
    )
    expect(graph.agents.get('a2')?.card.worktreeId).toBe('child')
    expect(graph.workspaces.get('main')?.agentPaneKeys).toEqual(['a1'])
    // Once the worker's tab closes, only the coordinator's workspace lists it.
    const closed = buildProjectMapGraph(
      snapshot(
        [workspace('main'), workspace('child', 'main')],
        [card('a1', 'main'), card('a2', 'main', 'a1')]
      ),
      'repo',
      sessions
    )
    expect(closed.agents.get('a2')?.card.worktreeId).toBe('child')
    expect(closed.workspaces.get('child')?.agentPaneKeys).toEqual(['a2'])
  })

  it('drops a delegation edge that would close a cycle', () => {
    const graph = buildProjectMapGraph(
      snapshot([workspace('main')], [card('a1', 'main', 'a2'), card('a2', 'main', 'a1')]),
      'repo'
    )
    expect(graph.edges.filter((edge) => edge.kind === 'delegate')).toHaveLength(1)
  })

  it('routes every wire rightward and grids workspaces that have nothing to show', () => {
    const graph = buildProjectMapGraph(
      snapshot(
        [
          workspace('main'),
          workspace('feature-a', 'main'),
          workspace('feature-a-2', 'feature-a'),
          workspace('feature-b', 'main'),
          workspace('scratch'),
          workspace('notes')
        ],
        [
          card('c1', 'main'),
          card('c2', 'main', 'c1'),
          card('c3', 'feature-b', 'c1'),
          card('c4', 'feature-a', 'c1'),
          card('c5', 'notes')
        ]
      ),
      'repo'
    )
    const layout = layoutProjectMap(graph)
    expect(layout.wires).toHaveLength(6)
    for (const wire of layout.wires) {
      const [x0, , , , , , x1] = (wire.path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
      expect(x1).toBeGreaterThan(x0)
    }
    // A same-lane delegation stays on its parent's row.
    expect(layout.nodes.get('c2')?.y).toBe(layout.nodes.get('c1')?.y)
    // `notes` has an agent, so it keeps a lane; `scratch` has neither lineage nor agents.
    expect(layout.lanes.map((lane) => lane.workspaceId)).toEqual([
      'main',
      'feature-a',
      'feature-a-2',
      'feature-b',
      'notes'
    ])
    expect(layout.looseGroup).not.toBeNull()
    expect(layout.nodes.get('scratch')?.y).toBeGreaterThan(layout.lanes.at(-1)?.y ?? Infinity)
  })
})
