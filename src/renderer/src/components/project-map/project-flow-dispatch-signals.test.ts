import { describe, expect, it } from 'vitest'
import { diffDispatchSignals } from './project-flow-dispatch-signals'

type Status = 'pending' | 'dispatched' | 'completed' | 'failed' | 'circuit_broken'

const worker = (
  dispatchStatus: Status,
  dispatchId = 'd1',
  parentPaneKey: string | null = 'coord'
) => ({
  dispatchId,
  dispatchStatus,
  ...(parentPaneKey ? { parentPaneKey } : {})
})

describe('diffDispatchSignals', () => {
  it('only sets the baseline on the first snapshot', () => {
    const first = diffDispatchSignals(null, { w1: worker('dispatched'), w2: worker('completed') })
    expect(first.signals).toEqual([])
    expect(first.baseline.get('w1')).toEqual({ dispatchId: 'd1', status: 'dispatched' })
  })

  it('flies a delegation from the parent to the worker when pending becomes dispatched', () => {
    const { baseline } = diffDispatchSignals(null, { w1: worker('pending') })
    const next = diffDispatchSignals(baseline, { w1: worker('dispatched') })
    expect(next.signals).toEqual([
      { id: 'd1:dispatched', from: 'coord', to: 'w1', tone: 'delegate' }
    ])
  })

  it('flies a report back to the parent, in the failure tone when the dispatch failed', () => {
    const { baseline } = diffDispatchSignals(null, {
      w1: worker('dispatched'),
      w2: worker('dispatched', 'd2')
    })
    const next = diffDispatchSignals(baseline, {
      w1: worker('completed'),
      w2: worker('failed', 'd2')
    })
    expect(next.signals).toEqual([
      { id: 'd1:completed', from: 'w1', to: 'coord', tone: 'success' },
      { id: 'd2:failed', from: 'w2', to: 'coord', tone: 'failure' }
    ])
  })

  it('does not replay an unchanged snapshot', () => {
    const { baseline } = diffDispatchSignals(null, { w1: worker('dispatched') })
    expect(diffDispatchSignals(baseline, { w1: worker('dispatched') }).signals).toEqual([])
  })

  it('flies a delegation for a worker that appears already dispatched after the baseline', () => {
    const { baseline } = diffDispatchSignals(null, { w1: worker('dispatched') })
    const next = diffDispatchSignals(baseline, {
      w1: worker('dispatched'),
      w2: worker('dispatched', 'd2'),
      w3: worker('dispatched', 'd3', null)
    })
    expect(next.signals).toEqual([
      { id: 'd2:dispatched', from: 'coord', to: 'w2', tone: 'delegate' }
    ])
  })

  it('flies a new dispatch in a pane that held another, but not a new one that already ended', () => {
    const { baseline } = diffDispatchSignals(null, { w1: worker('completed') })
    const next = diffDispatchSignals(baseline, {
      w1: worker('dispatched', 'd9'),
      w2: worker('completed', 'd2')
    })
    expect(next.signals).toEqual([
      { id: 'd9:dispatched', from: 'coord', to: 'w1', tone: 'delegate' }
    ])
  })

  it('ignores transitions that are not a delegation or a report', () => {
    const { baseline } = diffDispatchSignals(null, {
      w1: worker('pending'),
      w3: worker('completed', 'd3')
    })
    const next = diffDispatchSignals(baseline, {
      w1: worker('completed'),
      w3: worker('dispatched', 'd3')
    })
    expect(next.signals).toEqual([])
  })

  it('flies a tripped breaker back as a failure', () => {
    const { baseline } = diffDispatchSignals(null, { w2: worker('dispatched', 'd2') })
    const next = diffDispatchSignals(baseline, { w2: worker('circuit_broken', 'd2') })
    expect(next.signals).toEqual([
      { id: 'd2:circuit_broken', from: 'w2', to: 'coord', tone: 'failure' }
    ])
  })

  it('leaves delegations and reports to a host that sends its own events', () => {
    const sends = (paneKey: string): boolean => paneKey === 'formal'
    const { baseline } = diffDispatchSignals(null, {
      formal: worker('dispatched', 'd1'),
      legacy: worker('dispatched', 'd2'),
      tripped: worker('dispatched', 'd3')
    })
    const next = diffDispatchSignals(
      baseline,
      {
        formal: worker('completed', 'd1'),
        legacy: worker('completed', 'd2'),
        tripped: worker('circuit_broken', 'd3'),
        arrived: worker('dispatched', 'd4')
      },
      (paneKey) => sends(paneKey) || paneKey === 'tripped' || paneKey === 'arrived'
    )
    expect(next.signals.map((signal) => signal.id)).toEqual(['d2:completed', 'd3:circuit_broken'])
  })

  it('does not replay a delegation when a pane drops out of one snapshot and comes back', () => {
    const { baseline } = diffDispatchSignals(null, { w1: worker('dispatched') })
    const gap = diffDispatchSignals(baseline, {})
    expect(diffDispatchSignals(gap.baseline, { w1: worker('dispatched') }).signals).toEqual([])
  })

  it('needs a parent other than the worker itself', () => {
    const { baseline } = diffDispatchSignals(null, {
      w1: worker('pending', 'd1', null),
      w2: worker('pending', 'd2', 'w2')
    })
    const next = diffDispatchSignals(baseline, {
      w1: worker('dispatched', 'd1', null),
      w2: worker('dispatched', 'd2', 'w2')
    })
    expect(next.signals).toEqual([])
  })
})
