import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import type {
  DashboardCard,
  DashboardCardDotState,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import type { AgentSessionReferenceLink } from '../../../../shared/agent-session-reference-link'
import type { ProjectMapForkInput } from './project-map-graph'
import type { GrowthTreeInput } from './growth-tree-build'

export const GROWTH_NOW = 10_000_000

const workspace = (
  repoId: string,
  worktreeId: string,
  extra: Partial<DashboardWorkspace> = {}
): DashboardWorkspace => ({
  repoId,
  worktreeId,
  repoName: repoId,
  worktreeName: worktreeId,
  hostKind: 'local',
  executionHostId: 'local',
  workspaceKind: 'worktree',
  ...extra
})

export function growthCard(
  paneKey: string,
  worktreeId: string,
  startedAt: number,
  extra: Partial<DashboardCard> & { dotState?: DashboardCardDotState } = {}
): DashboardCard {
  const repoId = worktreeId.startsWith('b-') ? 'repo-b' : 'repo-a'
  return {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket: 'done',
    dotState: 'done',
    task: paneKey,
    repoId,
    worktreeId,
    tabId: `tab-${paneKey}`,
    leafId: null,
    repoName: repoId,
    worktreeName: worktreeId,
    startedAt,
    finishedAt: startedAt + 1000,
    stateChangedAt: startedAt + 1000,
    unseen: false,
    ...extra
  }
}

const chat = (sessionId: string) => ({
  sessionId,
  agent: 'claude',
  executionHostId: 'local' as const
})

function reference(
  carrier: string,
  source: string,
  workspaceId: string,
  createdAt: number,
  sourceMessageCount: number | null
): AgentSessionReferenceLink {
  return {
    targetSessionId: carrier,
    messageId: `m-${createdAt}`,
    messageIndex: 0,
    referenceUri: `orca-conversation://reference/${source}`,
    title: source,
    source: { sessionId: source, workspaceId },
    sourceMessageCount,
    createdAt
  }
}

function fork(child: string, sources: string[], createdAt: number): AgentSessionLineageEntry {
  return {
    childSessionId: child,
    sourceSessionId: sources[0]!,
    originSessionId: sources[0]!,
    mode: 'transcript',
    cut: { journalItemId: 'i', journalEpoch: 'e', journalSequence: 1, messageCount: 1 },
    sourceProvider: 'claude',
    createdAt,
    ...(sources.length > 1
      ? {
          sources: sources.map((sessionId) => ({
            sessionId,
            cut: { journalItemId: 'i', journalEpoch: 'e', journalSequence: 1, messageCount: 1 },
            sourceProvider: 'claude'
          }))
        }
      : {})
  }
}

/**
 * Project A: `a-main` (no creation time, as from an older host) with a coordinator, a worker that finished, a skewed-clock worker, three
 * chats merged into one, and a hand-off whose source closed; `a-feat` derived from `a-main`;
 * a folder workspace `a-notes`; an empty `a-empty`. Project B: `b-main`, one chat the A
 * coordinator delegated to.
 */
export function growthFixture(hidden: ReadonlySet<string> = new Set()): GrowthTreeInput {
  const cards = [
    growthCard('lead', 'a-main', 1_000_000, {
      bucket: 'working',
      dotState: 'working',
      finishedAt: null
    }),
    growthCard('worker', 'a-main', 2_000_000, { parentPaneKey: 'lead', finishedAt: 3_000_000 }),
    growthCard('skewed', 'a-main', 500_000, { parentPaneKey: 'lead' }),
    growthCard('future', 'a-main', GROWTH_NOW + 9_000_000, { parentPaneKey: 'lead' }),
    growthCard('s1', 'a-notes', 4_000_000),
    growthCard('s2', 'a-notes', 4_100_000),
    growthCard('s3', 'a-main', 4_200_000),
    growthCard('merged', 'a-notes', 5_000_000),
    growthCard('feat-chat', 'a-feat', 6_000_000, {
      bucket: 'working',
      dotState: 'working',
      finishedAt: null
    }),
    growthCard('handed', 'a-main', 7_000_000),
    growthCard('b-chat', 'b-main', 8_000_000, { parentPaneKey: 'lead' })
  ]
  const snapshot: DashboardSnapshot = {
    generatedAt: GROWTH_NOW,
    cards,
    workspaces: [
      workspace('repo-a', 'a-main'),
      workspace('repo-a', 'a-feat', { parentWorktreeId: 'a-main', createdAt: 5_500_000 }),
      workspace('repo-a', 'a-notes', {
        workspaceKind: 'folder',
        parentWorktreeId: 'a-main',
        createdAt: 3_000_000
      }),
      workspace('repo-a', 'a-empty'),
      workspace('repo-b', 'b-main', { hostKind: 'ssh', hostLabel: 'build-box' })
    ]
  }
  const lineage = new Map<string, AgentSessionLineageEntry>([
    ['sess_merged', fork('sess_merged', ['sess_s1', 'sess_s2', 'sess_s3'], 4_900_000)],
    ['sess_handed', fork('sess_handed', ['sess_closed'], 6_900_000)]
  ])
  const chatsByPaneKey = new Map(
    ['lead', 'feat-chat', 's1', 's2', 's3', 'merged', 'handed'].map((key) => [
      key,
      chat(`sess_${key}`)
    ])
  )
  const forks: ProjectMapForkInput = {
    chatsByPaneKey,
    lineage,
    references: [
      reference('sess_feat-chat', 'sess_lead', 'a-main', 6_100_000, 3),
      reference('sess_merged', 'sess_s3', 'a-main', 5_100_000, 2),
      reference('sess_merged', 'sess_s3', 'a-main', 5_200_000, null)
    ],
    history: new Map([
      ['sess_closed', { ...chat('sess_closed'), workspaceId: 'a-main', title: 'closed source' }]
    ]),
    hidden,
    titleOf: (card) => card.task
  }
  return {
    snapshot,
    projects: [
      { id: 'repo-a', name: 'Alpha' },
      { id: 'repo-b', name: 'Beta' }
    ],
    sessions: new Map(),
    forks,
    now: GROWTH_NOW
  }
}
