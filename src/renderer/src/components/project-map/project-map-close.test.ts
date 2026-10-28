import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import { buildProjectMapGraph } from './project-map-graph'
import type { ProjectMapChat } from './project-map-lineage'
import type { ProjectMapClosedChat } from '@/lib/project-map-closed-by-map'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const snapshot = (cards: DashboardCard[]): DashboardSnapshot => ({
  generatedAt: 0,
  workspaces: [
    {
      repoId: 'repo',
      worktreeId: 'main',
      repoName: 'repo',
      worktreeName: 'main',
      hostKind: 'local',
      executionHostId: 'local',
      workspaceKind: 'worktree'
    }
  ],
  cards
})

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

const chat = (sessionId: string): ProjectMapChat => ({
  sessionId,
  agent: 'claude',
  executionHostId: 'local'
})

const lineage = (child: string, source: string): AgentSessionLineageEntry => ({
  childSessionId: child,
  sourceSessionId: source,
  originSessionId: source,
  mode: 'native',
  cut: { journalItemId: 'i', journalEpoch: 'e', journalSequence: 3, messageCount: 3 },
  sourceProvider: 'claude',
  createdAt: 0
})

const closed = (sessionId: string): ProjectMapClosedChat => ({
  sessionId,
  workspaceId: 'main',
  executionHostId: 'local',
  agent: 'claude',
  title: 'Gone chat',
  closedAt: 1
})

function build(over: Partial<NonNullable<Parameters<typeof buildProjectMapGraph>[3]>>) {
  return buildProjectMapGraph(snapshot([card('root', 1), card('kid', 2)]), 'repo', new Map(), {
    chatsByPaneKey: new Map([
      ['root', chat('s-root')],
      ['kid', chat('s-kid')]
    ]),
    lineage: new Map([['s-kid', lineage('s-kid', 's-root')]]),
    titleOf: (c) => c.task,
    ...over
  })
}

describe('closed by the map', () => {
  it('draws a chat closed from the map as a grey history node', () => {
    const graph = build({ closedByMap: [closed('s-gone')] })
    const history = [...graph.agents.values()].filter((agent) => agent.history)
    expect(history.map((agent) => agent.chat?.sessionId)).toEqual(['s-gone'])
    expect(graph.workspaces.get('main')?.agentPaneKeys).toContain(history[0]!.card.paneKey)
  })

  it('does not draw it while the chat is open again', () => {
    const graph = build({ closedByMap: [closed('s-kid')] })
    expect([...graph.agents.values()].some((agent) => agent.history)).toBe(false)
  })
})

describe('hidden nodes', () => {
  it('leaves a hidden chat off the map and keeps its handoff as an unloaded source', () => {
    const graph = build({ hidden: new Set(['s-root']) })
    expect(graph.agents.has('root')).toBe(false)
    const kid = graph.agents.get('kid')!
    expect(kid.parentPaneKey).toBeNull()
    expect(kid.hasUnresolvedParent).toBe(true)
    expect(kid.sourceHidden).toBe(true)
    expect(graph.edges).toEqual([])
    expect(graph.workspaces.get('main')?.agentPaneKeys).toEqual(['kid'])
    expect(graph.hiddenKeys).toEqual(['s-root'])
  })

  it('counts only the hidden keys that matched a node here', () => {
    expect(build({ hidden: new Set(['elsewhere']) }).hiddenKeys).toBeUndefined()
  })
})

describe('undo', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('takes back the newest action first and keeps twenty', async () => {
    const { pushProjectMapUndo, undoProjectMap, projectMapUndoDepth } =
      await import('./use-project-map-undo')
    const ran: number[] = []
    for (let index = 0; index < 25; index++) {
      pushProjectMapUndo({ label: `${index}`, undo: () => void ran.push(index) })
    }
    expect(projectMapUndoDepth()).toBe(20)
    await undoProjectMap()
    await undoProjectMap()
    expect(ran).toEqual([24, 23])
  })

  it('keeps an action whose undo failed so it can be tried again', async () => {
    const { pushProjectMapUndo, undoProjectMap, projectMapUndoDepth } =
      await import('./use-project-map-undo')
    let reachable = false
    pushProjectMapUndo({
      label: 'chat',
      undo: () => {
        if (!reachable) {
          throw new Error('unreachable')
        }
      }
    })
    expect(await undoProjectMap()).toBe(false)
    expect(projectMapUndoDepth()).toBe(1)
    reachable = true
    expect(await undoProjectMap()).toBe(true)
    expect(projectMapUndoDepth()).toBe(0)
  })
})
