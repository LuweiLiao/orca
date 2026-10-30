import { parseProjectFlowEvent } from '../../../../shared/project-flow-event'
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

const intake = createProjectFlowIntake(appFlowSignalBus, flowLookupFromStore)

/** A host's event, local or remote, is untrusted until it parses. */
export function acceptProjectFlowEvent(raw: unknown): void {
  const event = parseProjectFlowEvent(raw)
  if (event) {
    intake.accept(event)
  }
}

export const retryHeldProjectFlowEvents = intake.retry
