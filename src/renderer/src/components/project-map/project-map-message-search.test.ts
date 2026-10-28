import { describe, expect, it } from 'vitest'
import type {
  AiVaultSearchHit,
  AiVaultSearchResponse
} from '../../../../shared/ai-vault-search-types'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { ProjectMapAgent, ProjectMapGraph } from './project-map-graph'
import { projectMapMessageHits, projectMapSearchProjectKey } from './project-map-message-search'

const card = (paneKey: string): DashboardCard => ({
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
  startedAt: 0,
  finishedAt: null,
  stateChangedAt: 0,
  unseen: false
})

const agent = (paneKey: string, sessionId?: string): ProjectMapAgent => ({
  card: card(paneKey),
  ...(sessionId ? { chat: { sessionId, agent: 'claude', executionHostId: 'local' } } : {}),
  parentPaneKey: null,
  hasUnresolvedParent: false,
  childPaneKeys: []
})

const graph = (agents: ProjectMapAgent[]): ProjectMapGraph => ({
  projectId: 'repo',
  workspaces: new Map(),
  agents: new Map(agents.map((a) => [a.card.paneKey, a])),
  edges: []
})

const hit = (sessionId: string | null, snippet = 'x'): AiVaultSearchHit => ({
  agent: 'claude',
  sessionId: `provider-${sessionId}`,
  title: 't',
  cwd: null,
  branch: null,
  updatedAt: null,
  messageCount: 1,
  score: 1,
  source: { presence: 'missing' },
  evidence: { snippet, role: 'assistant', timestamp: null },
  ...(sessionId ? { structuredSession: { sessionId, workspaceId: 'w' } } : {})
})

const results = (hosts?: { executionHostId: string; outcome: 'searched' | 'disabled' }[]) =>
  ({
    kind: 'results',
    hits: [],
    page: { cursor: null, hasMore: false },
    generation: 1,
    truncated: { candidates: false, snippets: 0, query: false, freshness: false },
    durationMs: 1,
    ...(hosts ? { hosts } : {})
  }) satisfies AiVaultSearchResponse

describe('projectMapMessageHits', () => {
  it('lays each matching chat onto its node once, counting the ones off the map', () => {
    const map = graph([agent('p1', 'claude_a'), agent('p2', 'claude_b'), agent('term')])
    const found = projectMapMessageHits(map, results(), [
      hit('claude_b', 'first [[match]]'),
      hit('claude_b', 'second'),
      hit('claude_elsewhere'),
      hit(null)
    ])
    expect(found.hits).toEqual([
      { paneKey: 'p2', sessionId: 'claude_b', snippet: 'first [[match]]', role: 'assistant' }
    ])
    expect(found.elsewhere).toBe(1)
    expect(found.skipped).toBeNull()
  })

  it('says why messages went unsearched, on one computer or on some of them', () => {
    const map = graph([])
    expect(
      projectMapMessageHits(map, { kind: 'unavailable', reason: 'disabled' }, []).skipped
    ).toBe('off')
    expect(
      projectMapMessageHits(map, { kind: 'unavailable', reason: 'not-ready' }, []).skipped
    ).toBe('not-ready')
    const partial = results([
      { executionHostId: 'local', outcome: 'searched' },
      { executionHostId: 'runtime:x', outcome: 'disabled' }
    ])
    expect(projectMapMessageHits(map, partial, []).skipped).toBe('off')
  })
})

describe('projectMapSearchProjectKey', () => {
  it('scopes to the project the workspaces belong to, else to the repo', () => {
    expect(
      projectMapSearchProjectKey('r1', [{ repoId: 'r1' }, { repoId: 'r1', projectId: 'p9' }])
    ).toBe('project:p9')
    expect(projectMapSearchProjectKey('r1', [{ repoId: 'r1' }])).toBe('repo:r1')
  })
})
