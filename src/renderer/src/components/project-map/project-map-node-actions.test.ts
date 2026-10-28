import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { Tab } from '../../../../shared/tab-types'
import type { ProjectMapAgent } from './project-map-graph'
import {
  projectMapAgentActions,
  projectMapAgentHasTab,
  projectMapCloseConfirmation,
  projectMapCloseUndoable,
  projectMapGroupActions,
  projectMapHideKeysOf,
  projectMapHistoryIsWired
} from './project-map-node-actions'

function agent(
  over: Partial<ProjectMapAgent> = {},
  card: Partial<DashboardCard> = {}
): ProjectMapAgent {
  return {
    card: {
      paneKey: 'a1',
      ptyId: null,
      agentType: 'claude',
      bucket: 'done',
      dotState: 'done',
      task: 'Do it',
      repoId: 'repo',
      worktreeId: 'main',
      tabId: 'tab-a1',
      leafId: null,
      repoName: 'repo',
      worktreeName: 'main',
      hostKind: 'local',
      executionHostId: 'local',
      startedAt: 1,
      finishedAt: null,
      stateChangedAt: 0,
      unseen: false,
      ...card
    },
    chat: { sessionId: 's1', agent: 'claude', executionHostId: 'local' },
    parentPaneKey: null,
    hasUnresolvedParent: false,
    childPaneKeys: [],
    ...over
  }
}

const idle = { hasTab: true, hostTooOld: false }

function byId(actions: ReturnType<typeof projectMapAgentActions>) {
  return Object.fromEntries(actions.map((action) => [action.id, action]))
}

describe('projectMapAgentActions', () => {
  it('offers an open chat everything its tab and host allow', () => {
    const actions = byId(projectMapAgentActions(agent(), idle))
    expect(actions['open-tab']).toEqual({ id: 'open-tab', enabled: true })
    expect(actions.reference?.enabled).toBe(true)
    expect(actions['new-child']?.enabled).toBe(true)
    expect(actions.rename?.enabled).toBe(true)
    expect(actions['show-terminal']).toMatchObject({ enabled: false, reason: 'no-terminal' })
  })

  it('shows a terminal only for an agent that runs in one', () => {
    const actions = byId(projectMapAgentActions(agent({}, { ptyId: 'pty-1' }), idle))
    expect(actions['show-terminal']?.enabled).toBe(true)
  })

  it('greys a closed chat: it can only be reopened, referenced or read', () => {
    const actions = byId(
      projectMapAgentActions(agent({ history: true }), { ...idle, hasTab: false })
    )
    expect(actions['open-tab']?.enabled).toBe(true)
    expect(actions.reference?.enabled).toBe(true)
    expect(actions['new-child']).toMatchObject({ enabled: false, reason: 'closed' })
    expect(actions.rename).toMatchObject({ enabled: false, reason: 'no-tab' })
    expect(actions['mark-read']).toBeUndefined()
    expect(actions['mark-unread']).toBeUndefined()
  })

  it('cannot rename a worker that has no tab', () => {
    const actions = byId(projectMapAgentActions(agent(), { ...idle, hasTab: false }))
    expect(actions.rename).toMatchObject({ enabled: false, reason: 'no-tab' })
  })

  it('explains why a terminal agent or a remote chat cannot fork or be referenced', () => {
    const terminal = byId(projectMapAgentActions(agent({ chat: undefined }, { ptyId: 'p' }), idle))
    expect(terminal['new-child']).toMatchObject({ enabled: false, reason: 'no-chat' })
    expect(terminal.reference).toMatchObject({ enabled: false, reason: 'no-chat' })
    const ssh = byId(projectMapAgentActions(agent({}, { hostKind: 'ssh' }), idle))
    expect(ssh['new-child']).toMatchObject({ enabled: false, reason: 'remote-host' })
    const old = byId(projectMapAgentActions(agent(), { ...idle, hostTooOld: true }))
    expect(old['new-child']).toMatchObject({ enabled: false, reason: 'host-too-old' })
  })

  it('toggles between read and unread, and marks unread only a finished chat', () => {
    const unread = byId(projectMapAgentActions(agent({}, { unseen: true }), idle))
    expect(unread['mark-read']?.enabled).toBe(true)
    expect(unread['mark-unread']).toBeUndefined()
    const read = byId(projectMapAgentActions(agent(), idle))
    expect(read['mark-unread']?.enabled).toBe(true)
    const working = byId(projectMapAgentActions(agent({}, { dotState: 'working' }), idle))
    expect(working['mark-unread']).toMatchObject({ enabled: false, reason: 'not-finished' })
  })
})

describe('row move actions', () => {
  it('are offered only when the map can move rows, greyed at an edge', () => {
    expect(byId(projectMapAgentActions(agent(), idle))['move-up']).toBeUndefined()
    const actions = byId(
      projectMapAgentActions(agent(), { ...idle, rowMoves: { up: false, down: true } })
    )
    expect(actions['move-up']).toMatchObject({ enabled: false, reason: 'row-edge' })
    expect(actions['move-down']).toEqual({ id: 'move-down', enabled: true })
  })
})

describe('projectMapGroupActions', () => {
  it('marks a stack read only while a chat inside is unread', () => {
    expect(projectMapGroupActions([agent(), agent({}, { unseen: true })])).toEqual([
      { id: 'mark-read', enabled: true }
    ])
    expect(projectMapGroupActions([agent()])).toEqual([
      { id: 'mark-read', enabled: false, reason: 'all-read' }
    ])
  })
})

describe('projectMapAgentHasTab', () => {
  const tab = (over: Partial<Tab>): Tab => ({
    id: 'u1',
    entityId: 'e1',
    groupId: 'g',
    worktreeId: 'main',
    contentType: 'terminal',
    label: 'tab',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...over
  })
  it('finds a terminal by its pty tab and a structured chat by its own id', () => {
    const tabs = {
      main: [
        tab({ id: 'u1', entityId: 'term-1', contentType: 'terminal' }),
        tab({ id: 'chat-tab', entityId: 'x', contentType: 'agent-session' })
      ]
    }
    expect(projectMapAgentHasTab(tabs, { tabId: 'term-1' })).toBe(true)
    expect(projectMapAgentHasTab(tabs, { tabId: 'chat-tab' })).toBe(true)
    expect(projectMapAgentHasTab(tabs, { tabId: 'gone' })).toBe(false)
  })
})

describe('closing and hiding', () => {
  it('offers close and hide on an open chat, and hide alone on a worker with no tab', () => {
    const open = byId(projectMapAgentActions(agent(), idle))
    expect(open.close?.enabled).toBe(true)
    expect(open.hide?.enabled).toBe(true)
    expect(open['hide-tree']).toBeUndefined()
    const worker = byId(projectMapAgentActions(agent(), { ...idle, hasTab: false }))
    expect(worker.close).toBeUndefined()
    expect(worker.hide?.enabled).toBe(true)
  })

  it('offers hiding the handoffs only to a chat that has some', () => {
    const parent = byId(projectMapAgentActions(agent({ childPaneKeys: ['b'] }), idle))
    expect(parent['hide-tree']?.enabled).toBe(true)
  })

  it('gives a closed chat only removal from the map', () => {
    const closed = byId(
      projectMapAgentActions(agent({ history: true }), { ...idle, hasTab: false })
    )
    expect(closed['remove-from-map']?.enabled).toBe(true)
    expect(closed.close).toBeUndefined()
    expect(closed.hide).toBeUndefined()
  })

  it('confirms a terminal agent and a running chat, not an idle chat', () => {
    expect(projectMapCloseConfirmation(agent({ chat: undefined }, { ptyId: 'p' }))).toBe('terminal')
    expect(projectMapCloseConfirmation(agent({}, { dotState: 'working' }))).toBe('running')
    expect(projectMapCloseConfirmation(agent({}, { dotState: 'waiting' }))).toBe('running')
    expect(projectMapCloseConfirmation(agent({}, { dotState: 'blocked' }))).toBe('running')
    expect(projectMapCloseConfirmation(agent())).toBeNull()
  })

  it('lets a chat close be undone and a terminal close not', () => {
    expect(projectMapCloseUndoable(agent())).toBe(true)
    expect(projectMapCloseUndoable(agent({ chat: undefined }))).toBe(false)
  })

  it('hides a chat by its session, and its handoffs when asked', () => {
    const root = agent({ childPaneKeys: ['b'] }, { paneKey: 'a' })
    const child = agent(
      { chat: { sessionId: 's2', agent: 'claude', executionHostId: 'local' } },
      { paneKey: 'b' }
    )
    const agents = new Map([
      ['a', root],
      ['b', child]
    ])
    expect(projectMapHideKeysOf(agents, 'a', false)).toEqual(['s1'])
    expect(projectMapHideKeysOf(agents, 'a', true)).toEqual(['s1', 's2'])
  })

  it('knows whether a wire still ends at a closed chat', () => {
    const edges = [{ kind: 'handoff' as const, from: 'a', to: 'h' }]
    expect(projectMapHistoryIsWired(edges, 'h')).toBe(true)
    expect(projectMapHistoryIsWired(edges, 'z')).toBe(false)
  })
})
