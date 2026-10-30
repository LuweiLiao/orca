import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import type { FlowLookup } from './project-flow-intake'
import { readProjectFlowTimeline, type ProjectFlowTimeline } from './project-flow-history-reader'
import {
  projectFlowHistoryHosts,
  runtimeProjectFlowHistorySource
} from './project-flow-history-runtime'
import type { FlowSignalBus } from './project-flow-signal'
import {
  buildGrowthReplaySteps,
  growthReplayCoverage,
  growthReplayDelay,
  growthReplayNextIndex,
  growthReplayPosition,
  growthReplayRange,
  growthReplayTimeAt,
  GROWTH_REPLAY_SLIDER_MAX,
  type GrowthReplaySpeed
} from './growth-tree-replay'
import type { GrowthTree } from './growth-tree-types'

function lookupFrom(
  contexts: Readonly<Record<string, AgentStatusOrchestrationContext>>
): FlowLookup {
  const entries = Object.entries(contexts)
  const contextOf = (dispatchId: string) =>
    entries.find(([, context]) => context.dispatchId === dispatchId)
  return {
    paneOfDispatch: (dispatchId) => contextOf(dispatchId)?.[0] ?? null,
    coordinatorPaneOfDispatch: (dispatchId) => contextOf(dispatchId)?.[1].parentPaneKey ?? null,
    workspaceOfPullRequest: (repoId, prNumber) =>
      useAppStore
        .getState()
        .worktreesByRepo[repoId]?.find((worktree) => worktree.linkedPR === prNumber)?.id ?? null,
    parentWorkspaceOf: (workspaceId) =>
      useAppStore.getState().worktreeLineageById[workspaceId]?.parentWorktreeId ?? null
  }
}

type Options = { tree: GrowthTree; enabled: boolean; bus: FlowSignalBus }

/**
 * Replay of the recorded history over the tree: a playhead the person drags or lets run, and every
 * event it passes flown as a signal along the lines already drawn.
 */
export function useGrowthTreeReplay({ tree, enabled, bus }: Options) {
  const environments = useAppStore((s) => s.runtimeEnvironments)
  const contexts = useAppStore((s) => s.runtimeAgentOrchestrationByPaneKey)
  const reducedMotion = usePrefersReducedMotion()
  const [timeline, setTimeline] = useState<ProjectFlowTimeline | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<GrowthReplaySpeed>(1)
  const [runId, setRunId] = useState(0)
  const playhead = useRef(0)
  const range = useMemo(() => growthReplayRange(tree), [tree])
  const environmentIds = useMemo(
    () => environments.map((environment) => environment.id),
    [environments]
  )

  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    void readProjectFlowTimeline(
      projectFlowHistoryHosts(environmentIds),
      runtimeProjectFlowHistorySource
    ).then((read) => {
      if (!cancelled) {
        setTimeline(read)
      }
    })
    return () => {
      cancelled = true
    }
  }, [enabled, environmentIds])

  const steps = useMemo(
    () =>
      enabled && timeline
        ? buildGrowthReplaySteps(timeline.entries, lookupFrom(contexts), tree, String(runId))
        : [],
    [contexts, enabled, runId, timeline, tree]
  )

  useEffect(() => {
    if (!playing) {
      return
    }
    let timer: number | undefined
    const advance = (): void => {
      const next = steps[growthReplayNextIndex(steps, playhead.current)]
      const target = next?.at ?? range.to
      timer = window.setTimeout(
        () => {
          playhead.current = target
          setAt(target)
          if (!next) {
            setPlaying(false)
            return
          }
          if (!reducedMotion) {
            bus.publish(next.signal)
          }
          advance()
        },
        growthReplayDelay(target - playhead.current, speed)
      )
    }
    advance()
    return () => window.clearTimeout(timer)
  }, [bus, playing, range.to, reducedMotion, speed, steps])

  const seekTo = (time: number | null): void => {
    playhead.current = time ?? range.to
    setAt(time)
  }
  return {
    range,
    /** The moment the tree is drawn at; null while replay is closed. */
    at: enabled ? at : null,
    position: at === null ? GROWTH_REPLAY_SLIDER_MAX : growthReplayPosition(range, at),
    playing,
    speed,
    loading: enabled && timeline === null,
    coverage: growthReplayCoverage(timeline?.coverage ?? {}),
    hasEvents: steps.length > 0,
    setSpeed,
    play: () => {
      const start = at === null || at >= range.to ? range.from : at
      seekTo(start)
      setRunId((id) => id + 1)
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    seek: (position: number) => {
      setPlaying(false)
      seekTo(growthReplayTimeAt(range, position))
    },
    /** Closes replay: stops the playhead and returns the tree to now. */
    stop: () => {
      setPlaying(false)
      seekTo(null)
    }
  }
}
