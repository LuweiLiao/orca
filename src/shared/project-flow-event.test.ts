import { describe, expect, it } from 'vitest'
import { parseProjectFlowEvent } from './project-flow-event'

const valid = {
  type: 'projectFlow',
  id: 'd1:completed',
  flow: 'report',
  outcome: 'succeeded',
  from: { kind: 'worker', dispatchId: 'd1' },
  to: { kind: 'coordinator', dispatchId: 'd1' }
}

describe('parseProjectFlowEvent', () => {
  it('keeps exactly the fields of an event and nothing a host tacked on', () => {
    expect(parseProjectFlowEvent({ ...valid, body: 'secret report text' })).toEqual(valid)
  })

  it('drops an event with an unknown flow, outcome or end', () => {
    expect(parseProjectFlowEvent({ ...valid, flow: 'teleport' })).toBeNull()
    expect(parseProjectFlowEvent({ ...valid, outcome: 'maybe' })).toBeNull()
    expect(parseProjectFlowEvent({ ...valid, from: { kind: 'worker' } })).toBeNull()
    expect(
      parseProjectFlowEvent({ ...valid, to: { kind: 'pull-request', repoId: 'r' } })
    ).toBeNull()
    expect(parseProjectFlowEvent({ ...valid, id: '' })).toBeNull()
    expect(parseProjectFlowEvent(null)).toBeNull()
    expect(parseProjectFlowEvent({ type: 'reposChanged' })).toBeNull()
  })
})
