import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { ProjectMapAgent } from './project-map-graph'
import {
  projectMapBatchCloseKinds,
  projectMapBatchPlan,
  runProjectMapBatchByHost,
  summarizeProjectMapBatch,
  type ProjectMapBatchContext
} from './project-map-batch-plan'
import { projectMapStopPlan } from './project-map-stop-route'

function agent(
  id: string,
  over: Partial<ProjectMapAgent> = {},
  card: Partial<DashboardCard> = {}
): ProjectMapAgent {
  return {
    card: {
      paneKey: id,
      ptyId: null,
      agentType: 'claude',
      bucket: 'done',
      dotState: 'done',
      task: id,
      repoId: 'repo',
      worktreeId: 'main',
      tabId: `tab-${id}`,
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
    chat: { sessionId: `s-${id}`, agent: 'claude', executionHostId: 'local' },
    parentPaneKey: null,
    hasUnresolvedParent: false,
    childPaneKeys: [],
    ...over
  }
}

const context = (over: Partial<ProjectMapBatchContext> = {}): ProjectMapBatchContext => ({
  hasTab: () => true,
  orchestration: () => undefined,
  ...over
})

describe('projectMapStopPlan', () => {
  it('offers Stop only to a running chat', () => {
    expect(projectMapStopPlan(agent('a'), undefined)).toBeNull()
    expect(projectMapStopPlan(agent('a', {}, { dotState: 'working' }), undefined)).toEqual({
      route: { kind: 'chat', sessionId: 's-a', executionHostId: 'local' }
    })
    expect(projectMapStopPlan(agent('a', {}, { dotState: 'waiting' }), undefined)).toMatchObject({
      route: { kind: 'chat' }
    })
  })

  it('gives a terminal agent and a closed chat no Stop', () => {
    expect(
      projectMapStopPlan(agent('a', { chat: undefined }, { dotState: 'working' }), undefined)
    ).toBeNull()
    expect(
      projectMapStopPlan(agent('a', { history: true }, { dotState: 'working' }), undefined)
    ).toBeNull()
  })

  it('stops a worker through its live Dispatch, not its chat', () => {
    const running = agent('w', {}, { dotState: 'working' })
    expect(projectMapStopPlan(running, { dispatchId: 'd1', dispatchStatus: 'dispatched' })).toEqual(
      {
        route: { kind: 'worker', dispatchId: 'd1' }
      }
    )
    expect(
      projectMapStopPlan(running, { dispatchId: 'd1', dispatchStatus: 'completed' })
    ).toMatchObject({
      route: { kind: 'chat' }
    })
  })

  it('refuses a worker on another host and a chat on SSH or WSL', () => {
    const running = agent('w', {}, { dotState: 'working' })
    expect(
      projectMapStopPlan(running, {
        dispatchId: 'd1',
        dispatchStatus: 'dispatched',
        session: { executionHostId: 'runtime:other' }
      })
    ).toEqual({ block: 'remote-worker' })
    expect(
      projectMapStopPlan(agent('s', {}, { dotState: 'working', hostKind: 'ssh' }), undefined)
    ).toEqual({ block: 'remote-host' })
  })
})

describe('projectMapBatchPlan', () => {
  it('splits a selection by what each action can do and says why the rest is left', () => {
    const read = agent('read')
    const unseen = agent('unseen', {}, { unseen: true })
    const closed = agent('closed', { history: true })
    const plan = projectMapBatchPlan('mark-read', [read, unseen, closed], context())
    expect(plan.targets).toEqual([unseen])
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(['read', 'closed'])
  })

  it('closes only chats that still have a tab', () => {
    const open = agent('open')
    const worker = agent('worker')
    const plan = projectMapBatchPlan(
      'close',
      [open, worker],
      context({ hasTab: (a) => a === open })
    )
    expect(plan.targets).toEqual([open])
    expect(plan.skipped).toEqual([{ agent: worker, reason: 'no-tab' }])
  })

  it('hides every chat, closed ones included', () => {
    const all = [agent('a'), agent('b', { history: true })]
    expect(projectMapBatchPlan('hide', all, context()).targets).toEqual(all)
  })

  it('stops only running chats it can reach', () => {
    const running = agent('r', {}, { dotState: 'working' })
    const idle = agent('i')
    const ssh = agent('s', {}, { dotState: 'working', hostKind: 'ssh' })
    const plan = projectMapBatchPlan('stop', [running, idle, ssh], context())
    expect(plan.targets).toEqual([running])
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(['not-running', 'remote-host'])
  })

  it('references only structured chats', () => {
    const plain = agent('t', { chat: undefined })
    expect(projectMapBatchPlan('reference', [plain], context()).skipped[0]?.reason).toBe('no-chat')
  })
})

describe('projectMapBatchCloseKinds', () => {
  it('counts running chats and terminal agents, which are what a close must confirm', () => {
    const kinds = projectMapBatchCloseKinds([
      agent('idle'),
      agent('busy', {}, { dotState: 'working' }),
      agent('pty', { chat: undefined })
    ])
    expect(kinds).toEqual({ terminal: 1, running: 1 })
  })
})

describe('summarizeProjectMapBatch', () => {
  it('counts successes and groups failures by reason', () => {
    const summary = summarizeProjectMapBatch([
      { item: 1 },
      { item: 2, error: 'host unreachable' },
      { item: 3, error: 'host unreachable' },
      { item: 4, error: 'refused' }
    ])
    expect(summary).toEqual({
      succeeded: 1,
      failed: 3,
      reasons: [
        { reason: 'host unreachable', count: 2 },
        { reason: 'refused', count: 1 }
      ]
    })
  })
})

describe('runProjectMapBatchByHost', () => {
  it('runs a host in order, hosts side by side, and a failure stops no one else', async () => {
    const events: string[] = []
    const release: Record<string, () => void> = {}
    const items = ['a1', 'b1', 'a2']
    const done = runProjectMapBatchByHost(
      items,
      (item) => item[0]!,
      async (item) => {
        events.push(`start ${item}`)
        await new Promise<void>((resolve) => (release[item] = resolve))
        if (item === 'a1') {
          throw new Error('boom')
        }
        events.push(`end ${item}`)
      }
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['start a1', 'start b1'])
    release.a1!()
    release.b1!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    release.a2!()
    const outcomes = await done
    expect(outcomes.map((outcome) => [outcome.item, outcome.error])).toEqual([
      ['a1', 'boom'],
      ['b1', undefined],
      ['a2', undefined]
    ])
    expect(events.indexOf('start a2')).toBeGreaterThan(events.indexOf('start a1'))
  })
})
