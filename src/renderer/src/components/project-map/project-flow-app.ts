import { parseProjectFlowEvent } from '../../../../shared/project-flow-event'
import type { RuntimeClientEvent } from '../../../../shared/remote-runtime/session-graph/runtime-client-events'
import { useAppStore } from '@/store'
import { createProjectFlowIntake, type FlowLookup } from './project-flow-intake'
import { createFlowSignalBus } from './project-flow-signal'

/** The one channel every host's flights share; the blueprint subscribes while it is open. */
export const appFlowSignalBus = createFlowSignalBus()

function flowLookupFromStore(): FlowLookup {
  const state = useAppStore.getState()
  const contexts = Object.entries(state.runtimeAgentOrchestrationByPaneKey)
  const contextOf = (dispatchId: string) =>
    contexts.find(([, context]) => context.dispatchId === dispatchId)
  return {
    paneOfDispatch: (dispatchId) => contextOf(dispatchId)?.[0] ?? null,
    coordinatorPaneOfDispatch: (dispatchId) => contextOf(dispatchId)?.[1].parentPaneKey ?? null,
    workspaceOfPullRequest: (repoId, prNumber) =>
      state.worktreesByRepo[repoId]?.find((worktree) => worktree.linkedPR === prNumber)?.id ?? null,
    parentWorkspaceOf: (workspaceId) =>
      state.worktreeLineageById[workspaceId]?.parentWorktreeId ?? null
  }
}

let requestRefresh: () => void = () => {}

/** Set by the map while it is open, so a flight naming an unknown worker asks for a fresh graph. */
export function setProjectFlowRefresh(refresh: (() => void) | null): void {
  requestRefresh = refresh ?? (() => {})
}

const intake = createProjectFlowIntake(appFlowSignalBus, flowLookupFromStore, Date.now, () =>
  requestRefresh()
)

/** A host's event, local or remote, is untrusted until it parses. */
export function acceptProjectFlowEvent(raw: unknown, source: 'local' | 'remote' = 'remote'): void {
  const event = parseProjectFlowEvent(raw)
  if (event) {
    intake.accept(event, source)
  }
}

export const retryHeldProjectFlowEvents = intake.retry

/** A remote host's flight arrives as a runtime client event; true when this event was one. */
export function acceptClientEvent(event: RuntimeClientEvent): boolean {
  if (event.type !== 'projectFlow') {
    return false
  }
  acceptProjectFlowEvent(event)
  return true
}

export function register(unsubs: (() => void)[]): void {
  // Why: this machine's own host has no environment id, so its flights come by IPC.
  const unsubscribeLocal = window.api.runtime?.onProjectFlow?.((event) =>
    acceptProjectFlowEvent(event, 'local')
  )
  if (unsubscribeLocal) {
    unsubs.push(unsubscribeLocal)
  }
  unsubs.push(useAppStore.subscribe(retryHeldProjectFlowEvents))
}
