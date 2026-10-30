import { describe, expect, it, vi } from 'vitest'
import { PROJECT_FLOW_HISTORY_RUNTIME_CAPABILITY } from '../../../../shared/project-flow-history'
import {
  readProjectFlowTimeline,
  type ProjectFlowHistoryHost,
  type ProjectFlowHistorySource
} from './project-flow-history-reader'

const local: ProjectFlowHistoryHost = { hostId: 'local', target: { kind: 'local' } }
const old: ProjectFlowHistoryHost = {
  hostId: 'runtime:old',
  target: { kind: 'environment', environmentId: 'old' }
}
const down: ProjectFlowHistoryHost = {
  hostId: 'runtime:down',
  target: { kind: 'environment', environmentId: 'down' }
}

const row = (seq: number, occurredAt: number) => ({
  seq,
  occurredAt,
  kind: 'delegate',
  from: null,
  to: null
})

function source(overrides: Partial<ProjectFlowHistorySource> = {}): ProjectFlowHistorySource {
  return {
    supportsHistory: async (target) => target.kind === 'local' || target.environmentId !== 'old',
    fetchPage: async (target, params) => {
      if (target.kind === 'environment' && target.environmentId === 'down') {
        throw new Error('offline')
      }
      return params.cursor
        ? { entries: [row(3, 30)], nextCursor: null }
        : { entries: [row(1, 10), row(2, 20)], nextCursor: 'seq:2' }
    },
    ...overrides
  }
}

describe('readProjectFlowTimeline', () => {
  it('follows the cursor until the host has no more', async () => {
    const timeline = await readProjectFlowTimeline([local], source())
    expect(timeline.entries.map((entry) => entry.seq)).toEqual([1, 2, 3])
    expect(timeline.coverage).toEqual({ local: 'complete' })
  })

  it('reads a host without the capability as having no history, without asking it', async () => {
    const fetchPage = vi.fn(source().fetchPage)
    const timeline = await readProjectFlowTimeline([local, old], source({ fetchPage }))
    expect(timeline.coverage).toEqual({ local: 'complete', 'runtime:old': 'unsupported' })
    expect(fetchPage.mock.calls.every(([target]) => target.kind === 'local')).toBe(true)
    expect(timeline.entries.every((entry) => entry.hostId === 'local')).toBe(true)
  })

  it('keeps the other hosts when one cannot be reached', async () => {
    const timeline = await readProjectFlowTimeline([local, down], source())
    expect(timeline.coverage['runtime:down']).toBe('failed')
    expect(timeline.entries).toHaveLength(3)
  })

  it('drops rows a host sent that do not fit the shape', async () => {
    const timeline = await readProjectFlowTimeline(
      [local],
      source({
        fetchPage: async () => ({ entries: [row(1, 10), { seq: 'x' }, null, 5], nextCursor: null })
      })
    )
    expect(timeline.entries.map((entry) => entry.seq)).toEqual([1])
  })

  it('says so when a host has more than it reads', async () => {
    const timeline = await readProjectFlowTimeline(
      [local],
      source({
        fetchPage: async () => ({ entries: [], nextCursor: 'seq:1' })
      })
    )
    expect(timeline.coverage.local).toBe('truncated')
  })

  it('names the capability it checks', () => {
    expect(PROJECT_FLOW_HISTORY_RUNTIME_CAPABILITY).toBe('orchestration.project-flow-history.v1')
  })
})
