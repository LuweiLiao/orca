import { describe, expect, it } from 'vitest'
import {
  delegateFlowEvent,
  mergeFlowEvent,
  messageFlowEvent,
  reportFlowEvent,
  type FlowAddressResolver
} from './project-flow-events'
import { createProjectFlowPublisher } from './project-flow-publisher'

const resolver: FlowAddressResolver = {
  runCoordinator: (runId) =>
    runId === 'run1' ? { paneKey: 'coord-pane', orcaSessionId: null } : null,
  paneKeyOfHandle: (handle) => (handle === 'term_a' ? 'pane-a' : null)
}

describe('reportFlowEvent', () => {
  it('reports a settled worker_done once, in the colour of its outcome', () => {
    expect(reportFlowEvent({ action: 'completed', taskId: 't', dispatchId: 'd1' })).toMatchObject({
      id: 'd1:completed',
      flow: 'report',
      outcome: 'succeeded'
    })
    expect(reportFlowEvent({ action: 'failed', taskId: 't', dispatchId: 'd1' })).toMatchObject({
      id: 'd1:failed',
      outcome: 'failed'
    })
  })

  it('reports nothing for a rejected, stale, suppressed or ignored message', () => {
    expect(
      reportFlowEvent({ action: 'rejected', code: 'stale_dispatch', reason: 'old' })
    ).toBeNull()
    expect(
      reportFlowEvent({ action: 'rejected', code: 'inactive_dispatch', reason: 'ended' })
    ).toBeNull()
    expect(reportFlowEvent({ action: 'suppressed' })).toBeNull()
    expect(reportFlowEvent({ action: 'ignored' })).toBeNull()
    expect(reportFlowEvent({ action: 'heartbeat_recorded', dispatchId: 'd1' })).toBeNull()
  })

  it('shares its id with the delegation of the same dispatch only in the dispatch part', () => {
    expect(delegateFlowEvent('d1').id).toBe('d1:dispatched')
  })
})

describe('messageFlowEvent', () => {
  it('draws a hand-off from its sender to the run coordinator', () => {
    expect(
      messageFlowEvent(
        { id: 'm1', type: 'handoff', to_handle: 'run:run1' },
        { paneKey: 'pane-w', orcaSessionId: null },
        resolver
      )
    ).toEqual({
      type: 'projectFlow',
      id: 'message:m1',
      flow: 'handoff',
      from: { kind: 'pane', paneKey: 'pane-w' },
      to: { kind: 'pane', paneKey: 'coord-pane' }
    })
  })

  it('names a chat by its session even when it also has a pane key', () => {
    expect(
      messageFlowEvent(
        { id: 'm7', type: 'handoff', to_handle: 'term_a' },
        { paneKey: 'minted-pane', orcaSessionId: 'sess-w' },
        resolver
      )
    ).toMatchObject({ from: { kind: 'session', sessionId: 'sess-w' } })
  })

  it('keeps merge_ready apart from a merge', () => {
    const ready = messageFlowEvent(
      { id: 'm2', type: 'merge_ready', to_handle: 'term_a' },
      { orcaSessionId: 'sess-a' },
      resolver
    )
    expect(ready).toMatchObject({
      flow: 'merge-ready',
      from: { kind: 'session', sessionId: 'sess-a' },
      to: { kind: 'pane', paneKey: 'pane-a' }
    })
    expect(mergeFlowEvent('repo', 7).flow).toBe('merge')
    expect(mergeFlowEvent('repo', 7).id).not.toBe(ready?.id)
  })

  it('draws nothing for other message types or ends it cannot name', () => {
    const sender = { paneKey: 'pane-w' }
    expect(
      messageFlowEvent({ id: 'm3', type: 'status', to_handle: 'term_a' }, sender, resolver)
    ).toBeNull()
    expect(
      messageFlowEvent({ id: 'm4', type: 'handoff', to_handle: 'term_gone' }, sender, resolver)
    ).toBeNull()
    expect(
      messageFlowEvent({ id: 'm5', type: 'handoff', to_handle: 'run:nope' }, sender, resolver)
    ).toBeNull()
    expect(
      messageFlowEvent({ id: 'm6', type: 'handoff', to_handle: 'term_a' }, {}, resolver)
    ).toBeNull()
  })
})

describe('createProjectFlowPublisher', () => {
  it('sends a repeated occurrence once and a later one again', () => {
    let clock = 0
    const sent: string[] = []
    const publish = createProjectFlowPublisher(
      (event) => sent.push(event.id),
      () => clock
    )
    publish(delegateFlowEvent('d1'))
    publish(delegateFlowEvent('d1'))
    publish(delegateFlowEvent('d2'))
    clock += 61_000
    publish(delegateFlowEvent('d1'))
    expect(sent).toEqual(['d1:dispatched', 'd2:dispatched', 'd1:dispatched'])
  })
})
