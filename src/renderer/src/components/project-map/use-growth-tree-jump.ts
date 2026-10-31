import { useCallback, useState } from 'react'
import { showProjectMapKeys } from '@/lib/project-map-hidden'
import type { GrowthTreeJumpTarget } from './GrowthTreeView'
import type { ProjectMapGraph } from './project-map-graph'

export type GrowthTreeJumpNotice = {
  kind: 'hidden' | 'missing'
  hideKey: string | null
}

export type GrowthTreeLocateRequest = { id: string; nonce: number }

type Options = {
  graph: ProjectMapGraph | null
  hasProject: (projectId: string) => boolean
  openProject: (projectId: string) => void
}

type JumpState = {
  pending: GrowthTreeJumpTarget | null
  last: GrowthTreeJumpTarget | null
  notice: GrowthTreeJumpNotice | null
  locate: GrowthTreeLocateRequest | null
  nonce: number
}

const IDLE: JumpState = { pending: null, last: null, notice: null, locate: null, nonce: 0 }

/**
 * A jump from the growth tree to the blueprint. The blueprint of the target's project is built
 * first; then the node is located, or the person is told why it is not there. The outcome is
 * settled during render, so the blueprint never draws once without it.
 */
export function useGrowthTreeJump({ graph, hasProject, openProject }: Options) {
  const [state, setState] = useState(IDLE)
  const { pending } = state
  if (pending) {
    if (!hasProject(pending.projectId)) {
      setState({ ...state, pending: null, notice: { kind: 'missing', hideKey: null } })
    } else if (graph?.projectId === pending.projectId) {
      const found = graph.agents.has(pending.id) || graph.workspaces.has(pending.id)
      const hidden =
        pending.hideKey !== null && graph.hiddenKeys?.includes(pending.hideKey) === true
      const landing = found
        ? pending.id
        : graph.workspaces.has(pending.workspaceId)
          ? pending.workspaceId
          : null
      setState({
        ...state,
        pending: null,
        nonce: state.nonce + 1,
        notice: found
          ? null
          : { kind: hidden ? 'hidden' : 'missing', hideKey: hidden ? pending.hideKey : null },
        locate: landing ? { id: landing, nonce: state.nonce + 1 } : state.locate
      })
    }
  }

  const jump = useCallback(
    (target: GrowthTreeJumpTarget) => {
      openProject(target.projectId)
      setState((current) => ({ ...current, pending: target, last: target, notice: null }))
    },
    [openProject]
  )
  const unhide = useCallback(() => {
    if (state.notice?.hideKey && state.last) {
      showProjectMapKeys([state.notice.hideKey])
      const retry = state.last
      setState((current) => ({ ...current, pending: retry, notice: null }))
    }
  }, [state.last, state.notice])
  return {
    jump,
    pending: state.pending !== null,
    notice: state.notice,
    locate: state.locate,
    dismissNotice: () => setState((current) => ({ ...current, notice: null })),
    clearLocate: () => setState((current) => ({ ...current, locate: null })),
    unhide
  }
}
