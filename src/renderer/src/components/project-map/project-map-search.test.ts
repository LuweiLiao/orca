import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import { buildProjectMapGraph } from './project-map-graph'
import { searchProjectMap } from './project-map-search'
import { projectMapCenteredView } from './use-project-map-viewport'

const workspace = (id: string): DashboardWorkspace => ({
  repoId: 'repo',
  worktreeId: id,
  repoName: 'repo',
  worktreeName: id,
  hostKind: 'local',
  executionHostId: 'local',
  workspaceKind: 'worktree'
})

const card = (
  paneKey: string,
  worktreeId: string,
  extra: Partial<DashboardCard>
): DashboardCard => ({
  paneKey,
  ptyId: null,
  agentType: 'claude',
  bucket: 'done',
  dotState: 'done',
  task: '',
  repoId: 'repo',
  worktreeId,
  tabId: `tab-${paneKey}`,
  leafId: null,
  repoName: 'repo',
  worktreeName: worktreeId,
  startedAt: 1,
  finishedAt: null,
  stateChangedAt: 0,
  unseen: false,
  ...extra
})

const snapshot: DashboardSnapshot = {
  generatedAt: 0,
  workspaces: [workspace('main'), workspace('feature-login')],
  cards: [
    card('a1', 'main', { conversationName: 'Plan the API', task: 'design endpoints' }),
    card('a2', 'feature-login', {
      task: 'Fix login redirect',
      dotState: 'working',
      bucket: 'working'
    }),
    card('a3', 'main', { conversationName: 'Docs pass', task: 'write the API guide' })
  ]
}
const graph = buildProjectMapGraph(snapshot, 'repo', new Map(), {
  chatsByPaneKey: new Map(),
  lineage: new Map(),
  titleOf: (c) => c.conversationName || c.task || 'x'
})
const branchOf = (id: string): string | null => (id === 'feature-login' ? 'feat/login' : 'main')

const ids = (query: string): string[] =>
  searchProjectMap(graph, query, branchOf).map((hit) => hit.id)

describe('searchProjectMap', () => {
  it('finds nothing for a blank query', () => {
    expect(ids('   ')).toEqual([])
  })

  it('matches a title, a task, a branch and a state', () => {
    expect(ids('plan')).toEqual(['a1'])
    expect(ids('redirect')).toEqual(['a2'])
    expect(ids('feat/login')).toContain('feature-login')
    expect(ids('working')).toEqual(['a2'])
  })

  it('requires every word, in any field', () => {
    expect(ids('api guide')).toEqual(['a3'])
    expect(ids('api nothing')).toEqual([])
  })

  it('ranks a title match before a match found elsewhere', () => {
    expect(ids('api')).toEqual(['a1', 'a3'])
    expect(searchProjectMap(graph, 'docs', branchOf)[0]).toMatchObject({
      kind: 'agent',
      title: 'Docs pass',
      detail: 'main',
      closed: false
    })
  })

  it('finds a workspace by its name', () => {
    expect(searchProjectMap(graph, 'login', branchOf).map((hit) => hit.kind)).toContain('workspace')
  })
})

describe('projectMapCenteredView', () => {
  it('puts the middle of the box in the middle of the viewport at the given zoom', () => {
    const view = projectMapCenteredView(
      { width: 1000, height: 600 },
      { x: 100, y: 50, width: 200, height: 66 },
      0.5
    )
    expect(view).toEqual({ zoom: 0.5, x: 500 - 200 * 0.5, y: 300 - 83 * 0.5 })
  })
})
