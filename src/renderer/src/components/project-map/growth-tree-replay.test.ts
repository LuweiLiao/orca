import { describe, expect, it } from 'vitest'
import type { FlowLookup } from './project-flow-intake'
import type { ProjectFlowTimelineEntry } from './project-flow-history-timeline'
import { buildGrowthTree } from './growth-tree-build'
import { GROWTH_NOW, growthFixture } from './growth-tree-fixture'
import {
  buildGrowthReplaySteps,
  growthReplayCoverage,
  growthReplayDelay,
  growthReplayNextIndex,
  growthReplayPosition,
  growthReplayRange,
  growthReplayTimeAt,
  growthTreeAt
} from './growth-tree-replay'

const tree = buildGrowthTree(growthFixture())
const lookup: FlowLookup = {
  paneOfDispatch: () => null,
  coordinatorPaneOfDispatch: () => null,
  workspaceOfPullRequest: () => null,
  parentWorkspaceOf: () => null
}
const pane = (paneKey: string) => ({ kind: 'pane' as const, paneKey })
const entry = (
  seq: number,
  occurredAt: number,
  from: string,
  to: string,
  extra: Partial<ProjectFlowTimelineEntry> = {}
): ProjectFlowTimelineEntry => ({
  seq,
  occurredAt,
  kind: 'delegate',
  from: pane(from),
  to: pane(to),
  hostId: 'local',
  ...extra
})

describe('growthTreeAt', () => {
  it('shows only the chats that had begun, and draws a running one up to that moment', () => {
    const at = tree.bars.get('worker')!.start + 100
    const seen = growthTreeAt(tree, at)
    expect([...seen.bars.keys()]).toContain('lead')
    expect([...seen.bars.keys()]).toContain('worker')
    expect(seen.bars.has('s1')).toBe(false)
    for (const bar of seen.bars.values()) {
      expect(bar.start).toBeLessThanOrEqual(at)
      expect(bar.end).toBeLessThanOrEqual(at)
    }
    expect(seen.bars.get('worker')).toMatchObject({ running: true, state: 'working', end: at })
    expect(seen.now).toBe(at)
  })

  it('keeps a chat that finished before then as it ended', () => {
    const worker = tree.bars.get('worker')!
    const seen = growthTreeAt(tree, worker.end + 10)
    expect(seen.bars.get('worker')).toMatchObject({ running: false, end: worker.end })
  })

  it('draws a line only once both of its ends exist, and never one from the future', () => {
    const at = tree.bars.get('s2')!.start
    const seen = growthTreeAt(tree, at)
    for (const edge of seen.edges) {
      expect(edge.at).toBeLessThanOrEqual(at)
      expect(seen.bars.has(edge.from) || seen.lanes.has(edge.from)).toBe(true)
      expect(seen.bars.has(edge.to) || seen.lanes.has(edge.to)).toBe(true)
    }
    expect(seen.edges.some((edge) => edge.to === 'merged')).toBe(false)
    expect(growthTreeAt(tree, GROWTH_NOW).edges.length).toBe(tree.edges.length)
  })

  it('keeps every lane, so nothing moves, and gives the same answer twice', () => {
    const at = tree.bars.get('lead')!.start
    const a = growthTreeAt(tree, at)
    expect([...a.lanes.keys()]).toEqual([...tree.lanes.keys()])
    expect(growthTreeAt(tree, at)).toEqual(a)
  })
})

describe('buildGrowthReplaySteps', () => {
  it('orders the events as they happened and never moves the playhead back', () => {
    const steps = buildGrowthReplaySteps(
      [
        entry(2, 5_000_000, 'lead', 'worker'),
        entry(1, 1_000, 'lead', 'skewed'),
        entry(3, 4_900_000, 'lead', 'merged')
      ],
      lookup,
      tree,
      'a'
    )
    expect(steps.map((step) => step.signal.to)).toEqual(['worker', 'skewed', 'merged'])
    const times = steps.map((step) => step.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('holds an event until both its chats exist and never past now', () => {
    const [step] = buildGrowthReplaySteps([entry(1, 1, 'lead', 'worker')], lookup, tree, 'a')
    expect(step!.at).toBe(Math.max(tree.bars.get('lead')!.start, tree.bars.get('worker')!.start))
    const [late] = buildGrowthReplaySteps(
      [entry(1, GROWTH_NOW * 5, 'lead', 'worker')],
      lookup,
      tree,
      'a'
    )
    expect(late!.at).toBe(tree.now)
  })

  it('skips state changes and events it cannot place, and is the same every time', () => {
    const entries = [
      entry(1, 10, 'lead', 'worker', { kind: 'state' }),
      entry(2, 10, 'lead', 'nobody'),
      entry(3, 10, 'lead', 'worker')
    ]
    const a = buildGrowthReplaySteps(entries, lookup, tree, 'a')
    expect(a).toHaveLength(1)
    expect(a[0]!.signal).toMatchObject({ from: 'lead', to: 'worker', tone: 'delegate' })
    expect(buildGrowthReplaySteps(entries, lookup, tree, 'a')).toEqual(a)
    expect(buildGrowthReplaySteps(entries, lookup, tree, 'b')[0]!.signal.id).not.toBe(
      a[0]!.signal.id
    )
  })

  it('finds the step after a moment', () => {
    const steps = buildGrowthReplaySteps(
      [entry(1, 3_000_000, 'lead', 'worker'), entry(2, 4_000_000, 'lead', 'merged')],
      lookup,
      tree,
      'a'
    )
    expect(growthReplayNextIndex(steps, steps[0]!.at - 1)).toBe(0)
    expect(growthReplayNextIndex(steps, steps[0]!.at)).toBe(1)
    expect(growthReplayNextIndex(steps, steps[1]!.at)).toBe(2)
  })
})

describe('replay timing', () => {
  it('holds an idle stretch to a second and shortens it with speed', () => {
    expect(growthReplayDelay(10 * 60 * 1000, 1)).toBe(1_000)
    expect(growthReplayDelay(10 * 60 * 1000, 4)).toBe(250)
    expect(growthReplayDelay(10 * 60 * 1000, 16)).toBe(62.5)
    expect(growthReplayDelay(200, 1)).toBe(200)
    expect(growthReplayDelay(-5, 4)).toBe(0)
  })

  it('maps the slider onto the time from the first chat to now and back', () => {
    const range = growthReplayRange(tree)
    expect(range.to).toBe(tree.now)
    expect(growthReplayTimeAt(range, 0)).toBe(range.from)
    expect(growthReplayTimeAt(range, 1_000)).toBe(range.to)
    expect(growthReplayPosition(range, growthReplayTimeAt(range, 400))).toBe(400)
  })

  it('counts the hosts with no history or only part of it', () => {
    expect(
      growthReplayCoverage({
        local: 'complete',
        a: 'unsupported',
        b: 'failed',
        c: 'truncated'
      })
    ).toEqual({ missing: 2, partial: 1 })
  })
})
