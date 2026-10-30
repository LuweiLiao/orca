import { describe, expect, it } from 'vitest'
import type { ProjectFlowEvent } from '../../../../shared/project-flow-event'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../../shared/structured-agent-session-projection'
import {
  createProjectFlowIntake,
  resolveProjectFlowEvent,
  type FlowLookup
} from './project-flow-intake'
import { createFlowSignalBus, type FlowSignal } from './project-flow-signal'

const lookup: FlowLookup = {
  paneOfDispatch: (id) => (id === 'd1' ? 'worker-pane' : null),
  coordinatorPaneOfDispatch: (id) => (id === 'd1' ? 'coord-pane' : null),
  workspaceOfPullRequest: (repo, pr) => (repo === 'r' && pr === 7 ? 'wt-child' : null),
  parentWorkspaceOf: (id) => (id === 'wt-child' ? 'wt-main' : null)
}

const report = (outcome: 'succeeded' | 'failed'): ProjectFlowEvent => ({
  type: 'projectFlow',
  id: `d1:${outcome === 'succeeded' ? 'completed' : 'failed'}`,
  flow: 'report',
  outcome,
  from: { kind: 'worker', dispatchId: 'd1' },
  to: { kind: 'coordinator', dispatchId: 'd1' }
})

describe('resolveProjectFlowEvent', () => {
  it('draws a report from the worker to its coordinator in the colour of its outcome', () => {
    expect(resolveProjectFlowEvent(report('succeeded'), lookup)).toEqual({
      id: 'd1:completed',
      from: 'worker-pane',
      to: 'coord-pane',
      tone: 'success'
    })
    expect(resolveProjectFlowEvent(report('failed'), lookup)?.tone).toBe('failure')
  })

  it('names a chat by the pane its session has, and a hand-off by its own tone', () => {
    const signal = resolveProjectFlowEvent(
      {
        type: 'projectFlow',
        id: 'message:m1',
        flow: 'handoff',
        from: { kind: 'session', sessionId: 'sess-a' },
        to: { kind: 'pane', paneKey: 'tab:leaf' }
      },
      lookup
    )
    expect(signal).toEqual({
      id: 'message:m1',
      from: structuredAgentSessionPaneKey(structuredAgentSessionTabId('sess-a'), 'sess-a'),
      to: 'tab:leaf',
      tone: 'handoff'
    })
  })

  it('keeps a merge-ready note apart from a merge', () => {
    const base = {
      type: 'projectFlow' as const,
      from: { kind: 'workspace' as const, workspaceId: 'a' },
      to: { kind: 'workspace' as const, workspaceId: 'b' }
    }
    expect(resolveProjectFlowEvent({ ...base, id: 'x', flow: 'merge-ready' }, lookup)?.tone).toBe(
      'merge-ready'
    )
    expect(resolveProjectFlowEvent({ ...base, id: 'y', flow: 'merge' }, lookup)?.tone).toBe('merge')
  })

  it('flies a merge from the workspace of the PR to its parent, and nowhere when either is unknown', () => {
    const merge = (prNumber: number): ProjectFlowEvent => ({
      type: 'projectFlow',
      id: `merge:r:${prNumber}`,
      flow: 'merge',
      from: { kind: 'pull-request', repoId: 'r', prNumber },
      to: { kind: 'pull-request-base', repoId: 'r', prNumber }
    })
    expect(resolveProjectFlowEvent(merge(7), lookup)).toMatchObject({
      from: 'wt-child',
      to: 'wt-main',
      tone: 'merge'
    })
    expect(resolveProjectFlowEvent(merge(8), lookup)).toBeNull()
  })
})

describe('createProjectFlowIntake', () => {
  function setup() {
    const flown: FlowSignal[] = []
    const bus = createFlowSignalBus()
    bus.subscribe((signal) => flown.push(signal))
    let known = false
    let clock = 0
    const intake = createProjectFlowIntake(
      bus,
      () => (known ? lookup : { ...lookup, paneOfDispatch: () => null }),
      () => clock
    )
    return {
      flown,
      intake,
      learn: () => {
        known = true
      },
      advance: (ms: number) => {
        clock += ms
      }
    }
  }

  it('holds an event for a worker it has not heard of and flies it once it has', () => {
    const { flown, intake, learn } = setup()
    intake.accept(report('succeeded'))
    expect(flown).toEqual([])
    learn()
    intake.retry()
    expect(flown.map((signal) => signal.id)).toEqual(['d1:completed'])
    intake.retry()
    expect(flown).toHaveLength(1)
  })

  it('drops an event whose end never became known', () => {
    const { flown, intake, learn, advance } = setup()
    intake.accept(report('succeeded'))
    advance(2_500)
    learn()
    intake.retry()
    expect(flown).toEqual([])
  })
})
