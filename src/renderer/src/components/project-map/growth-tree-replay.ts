import type { ProjectFlowEvent } from '../../../../shared/project-flow-event'
import { resolveProjectFlowEvent, type FlowLookup } from './project-flow-intake'
import type { ProjectFlowHistoryCoverage } from './project-flow-history-reader'
import type { ProjectFlowTimelineEntry } from './project-flow-history-timeline'
import type { FlowSignal } from './project-flow-signal'
import type { GrowthTree } from './growth-tree-types'

export const GROWTH_REPLAY_SPEEDS = [1, 4, 16] as const
export type GrowthReplaySpeed = (typeof GROWTH_REPLAY_SPEEDS)[number]

/** The longest a quiet stretch between two events lasts at 1x; faster speeds shorten it further. */
export const GROWTH_REPLAY_MAX_IDLE_MS = 1_000
const SLIDER_STEPS = 1_000

export type GrowthReplayStep = {
  /** Where the playhead stands once this event has happened. */
  at: number
  signal: FlowSignal
}

export type GrowthReplayRange = { from: number; to: number }

/** From the first chat to now, the span the slider covers. */
export function growthReplayRange(tree: GrowthTree): GrowthReplayRange {
  const starts = [...tree.bars.values()].map((bar) => bar.start)
  return { from: starts.length > 0 ? Math.min(...starts) : tree.now, to: tree.now }
}

export function growthReplayTimeAt(range: GrowthReplayRange, position: number): number {
  const fraction = Math.min(SLIDER_STEPS, Math.max(0, position)) / SLIDER_STEPS
  return Math.round(range.from + (range.to - range.from) * fraction)
}

export function growthReplayPosition(range: GrowthReplayRange, at: number): number {
  return range.to > range.from
    ? Math.round(((at - range.from) / (range.to - range.from)) * SLIDER_STEPS)
    : SLIDER_STEPS
}

export const GROWTH_REPLAY_SLIDER_MAX = SLIDER_STEPS

/**
 * The tree as it stood at a moment: chats that had begun, drawn to that moment if they were still
 * going, and only the lines whose two ends both existed. Lanes stay, so nothing moves.
 */
export function growthTreeAt(tree: GrowthTree, at: number): GrowthTree {
  const bars = new Map<string, GrowthTree['bars'] extends Map<string, infer B> ? B : never>()
  for (const [id, bar] of tree.bars) {
    if (bar.start > at) {
      continue
    }
    const open = bar.end > at
    bars.set(
      id,
      open ? { ...bar, end: at, running: true, state: 'working', bucket: 'working' } : bar
    )
  }
  const lanes = new Map(
    [...tree.lanes].map(([id, lane]) => [
      id,
      { ...lane, barIds: lane.barIds.filter((barId) => bars.has(barId)) }
    ])
  )
  const here = (id: string): boolean => bars.has(id) || lanes.has(id)
  return {
    ...tree,
    now: at,
    bars,
    lanes,
    edges: tree.edges.filter((edge) => edge.at <= at && here(edge.from) && here(edge.to)),
    crossLinks: tree.crossLinks.filter(
      (link) => link.at <= at && bars.has(link.from) && bars.has(link.to)
    ),
    references: tree.references.filter(
      (reference) => reference.at <= at && bars.has(reference.from) && bars.has(reference.to)
    )
  }
}

/**
 * The events of the recorded history that this tree can show, in the order they happened. Each
 * waits for both its ends, so a flight never starts before the chat it leaves or reaches.
 */
export function buildGrowthReplaySteps(
  entries: readonly ProjectFlowTimelineEntry[],
  lookup: FlowLookup,
  tree: GrowthTree,
  runId: string
): GrowthReplayStep[] {
  const startOf = (id: string): number | null =>
    tree.bars.get(id)?.start ?? tree.lanes.get(id)?.start ?? null
  const steps: GrowthReplayStep[] = []
  let playhead = Number.NEGATIVE_INFINITY
  for (const entry of entries) {
    if (entry.kind === 'state' || !entry.from || !entry.to) {
      continue
    }
    const event: ProjectFlowEvent = {
      type: 'projectFlow',
      id: `replay:${runId}:${entry.hostId}:${entry.seq}`,
      flow: entry.kind,
      from: entry.from,
      to: entry.to,
      ...(entry.outcome ? { outcome: entry.outcome } : {})
    }
    const signal = resolveProjectFlowEvent(event, lookup)
    const [from, to] = signal ? [startOf(signal.from), startOf(signal.to)] : [null, null]
    if (!signal || from === null || to === null) {
      continue
    }
    playhead = Math.min(tree.now, Math.max(playhead, entry.occurredAt, from, to))
    steps.push({ at: playhead, signal })
  }
  return steps
}

/** Index of the first step after a moment; `steps.length` when none is left. */
export function growthReplayNextIndex(steps: readonly GrowthReplayStep[], at: number): number {
  const index = steps.findIndex((step) => step.at > at)
  return index === -1 ? steps.length : index
}

/** How long to wait before the next event: its real gap, held to a second, shortened by speed. */
export function growthReplayDelay(gapMs: number, speed: GrowthReplaySpeed): number {
  return Math.min(GROWTH_REPLAY_MAX_IDLE_MS, Math.max(0, gapMs)) / speed
}

/** Hosts whose recorded history is missing or cut short, to say so beside the slider. */
export function growthReplayCoverage(
  coverage: Readonly<Record<string, ProjectFlowHistoryCoverage>>
): {
  missing: number
  partial: number
} {
  const values = Object.values(coverage)
  return {
    missing: values.filter((value) => value === 'unsupported' || value === 'failed').length,
    partial: values.filter((value) => value === 'truncated').length
  }
}
