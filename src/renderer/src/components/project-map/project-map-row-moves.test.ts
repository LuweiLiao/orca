import { describe, expect, it } from 'vitest'
import type { DashboardCard, DashboardWorkspace } from '../../../../shared/dashboard-snapshot'
import { buildProjectMapGraph, type ProjectMapGraph } from './project-map-graph'
import { layoutProjectMap } from './project-map-layout'
import { projectMapRowMove, projectMapTidyRows } from './project-map-row-moves'

function workspace(id: string): DashboardWorkspace {
  return {
    repoId: 'repo',
    worktreeId: id,
    repoName: 'repo',
    worktreeName: id,
    hostKind: 'local',
    executionHostId: 'local',
    workspaceKind: 'worktree'
  }
}

function card(paneKey: string, worktreeId: string): DashboardCard {
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
    repoName: 'repo',
    worktreeName: worktreeId,
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false
  }
}

/** One chat per [paneKey, worktree, sessionId]; a null session is a node without a chat. */
function graphOf(chats: [string, string, string | null][]): ProjectMapGraph {
  const sessions = new Map(
    chats.flatMap(([paneKey, , sessionId]) =>
      sessionId
        ? [[paneKey, { sessionId, agent: 'claude', executionHostId: 'local' as const }]]
        : []
    )
  )
  return buildProjectMapGraph(
    {
      generatedAt: 0,
      cards: chats.map(([paneKey, worktreeId]) => card(paneKey, worktreeId)),
      workspaces: [...new Set(chats.map(([, worktreeId]) => worktreeId))].map(workspace)
    },
    'repo',
    undefined,
    { chatsByPaneKey: sessions, lineage: new Map(), titleOf: (item) => item.task }
  )
}

const three = graphOf([
  ['a', 'w', 's-a'],
  ['b', 'w', 's-b'],
  ['c', 'w', 's-c']
])

function rowsAfter(graph: ProjectMapGraph, changes: ReadonlyMap<string, number | null>) {
  const pins = new Map([...changes].flatMap(([id, row]) => (row === null ? [] : [[id, row]])))
  const layout = layoutProjectMap(graph, pins)
  return ['a', 'b', 'c'].map((key) => layout.nodes.get(key)!.y)
}

describe('projectMapRowMove', () => {
  it('swaps a chat with the one below and keeps the third where it was', () => {
    const layout = layoutProjectMap(three)
    const [ya, yb, yc] = ['a', 'b', 'c'].map((key) => layout.nodes.get(key)!.y)
    const changes = projectMapRowMove(three, layout, 'a', 'down')!
    expect(rowsAfter(three, changes)).toEqual([yb, ya, yc])
  })

  it('moves up and down as inverses', () => {
    const layout = layoutProjectMap(three)
    const down = projectMapRowMove(three, layout, 'b', 'down')!
    const moved = layoutProjectMap(
      three,
      new Map([...down].flatMap(([id, row]) => (row === null ? [] : [[id, row]])))
    )
    const back = projectMapRowMove(three, moved, 'b', 'up')!
    expect(rowsAfter(three, back)).toEqual(['a', 'b', 'c'].map((key) => layout.nodes.get(key)!.y))
  })

  it('has nowhere to go past either end of the column', () => {
    const layout = layoutProjectMap(three)
    expect(projectMapRowMove(three, layout, 'a', 'up')).toBeNull()
    expect(projectMapRowMove(three, layout, 'c', 'down')).toBeNull()
  })

  it('stays inside its lane', () => {
    const graph = graphOf([
      ['a', 'w1', 's-a'],
      ['b', 'w2', 's-b']
    ])
    const layout = layoutProjectMap(graph)
    expect(projectMapRowMove(graph, layout, 'a', 'down')).toBeNull()
  })

  it('does not swap with a node that has no chat to remember a row under', () => {
    const graph = graphOf([
      ['a', 'w', 's-a'],
      ['b', 'w', null]
    ])
    const layout = layoutProjectMap(graph)
    expect(projectMapRowMove(graph, layout, 'a', 'down')).toBeNull()
  })

  it('ignores workspace nodes and unknown ids', () => {
    const layout = layoutProjectMap(three)
    expect(projectMapRowMove(three, layout, 'w', 'down')).toBeNull()
    expect(projectMapRowMove(three, layout, 'nope', 'up')).toBeNull()
  })
})

describe('projectMapTidyRows', () => {
  it('clears only this project’s pinned chats', () => {
    const pins = new Map([
      ['s-a', 2],
      ['other', 1]
    ])
    expect(projectMapTidyRows(three, pins)).toEqual(new Map([['s-a', null]]))
    expect(projectMapTidyRows(three, new Map()).size).toBe(0)
  })
})
