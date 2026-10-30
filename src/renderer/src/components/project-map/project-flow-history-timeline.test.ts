import { describe, expect, it } from 'vitest'
import type { ProjectFlowHistoryEntry } from '../../../../shared/project-flow-history'
import { mergeProjectFlowHistories } from './project-flow-history-timeline'

const entry = (seq: number, occurredAt: number): ProjectFlowHistoryEntry => ({
  seq,
  occurredAt,
  kind: 'delegate',
  from: null,
  to: null
})

const order = (hosts: Parameters<typeof mergeProjectFlowHistories>[0]): string[] =>
  mergeProjectFlowHistories(hosts).map((row) => `${row.hostId}#${row.seq}@${row.occurredAt}`)

describe('mergeProjectFlowHistories', () => {
  it('orders across hosts by time, then host id, then seq', () => {
    expect(
      order([
        { hostId: 'runtime:b', entries: [entry(1, 10), entry(2, 30)] },
        { hostId: 'local', entries: [entry(1, 10), entry(2, 20)] }
      ])
    ).toEqual(['local#1@10', 'runtime:b#1@10', 'local#2@20', 'runtime:b#2@30'])
  })

  it('is the same whichever order the hosts and rows arrive in', () => {
    const local = { hostId: 'local', entries: [entry(1, 5), entry(2, 5), entry(3, 9)] }
    const remote = { hostId: 'runtime:a', entries: [entry(7, 5), entry(8, 7)] }
    const expected = order([local, remote])
    expect(order([remote, local])).toEqual(expected)
    expect(order([{ ...local, entries: local.entries.toReversed() }, remote])).toEqual(expected)
  })

  it("never reorders one host's own rows, even when its clock stepped back", () => {
    const rows = order([
      { hostId: 'local', entries: [entry(1, 100), entry(2, 40), entry(3, 120)] },
      { hostId: 'runtime:a', entries: [entry(1, 50)] }
    ])
    expect(
      rows.filter((row) => row.startsWith('local')).map((row) => row.split('#')[1]?.[0])
    ).toEqual(['1', '2', '3'])
  })

  it('counts a row it was handed twice once', () => {
    expect(
      order([
        { hostId: 'local', entries: [entry(1, 1), entry(2, 2)] },
        { hostId: 'local', entries: [entry(2, 2), entry(3, 3)] }
      ])
    ).toEqual(['local#1@1', 'local#2@2', 'local#3@3'])
  })

  it('gives an empty timeline for no hosts or empty hosts', () => {
    expect(mergeProjectFlowHistories([])).toEqual([])
    expect(mergeProjectFlowHistories([{ hostId: 'local', entries: [] }])).toEqual([])
  })
})
