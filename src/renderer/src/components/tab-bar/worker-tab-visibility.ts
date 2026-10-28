import { useMemo, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { structuredAgentSessionTabId } from '../../../../shared/structured-agent-session-projection'

// Why: dispatched workers already sit under their coordinator in the sidebar; one tab per worker
// floods the strip. A worker tab shows once the user opens it (or it is active) and stays shown.

type WorkerTabInputs = Pick<
  AppState,
  'agentStatusByPaneKey' | 'runtimeAgentOrchestrationByPaneKey' | 'retainedAgentsByPaneKey'
>

const EMPTY_IDS: ReadonlySet<string> = new Set()

function isDispatchedWorker(context: AgentStatusOrchestrationContext | undefined): boolean {
  const dispatchId = context?.dispatchId
  return Boolean(dispatchId) && !dispatchId?.startsWith('subagent:')
}

function addWorker(
  ids: Set<string>,
  paneKey: string,
  context: AgentStatusOrchestrationContext | undefined
): void {
  if (!isDispatchedWorker(context)) {
    return
  }
  const tabId = parsePaneKey(paneKey)?.tabId
  if (tabId) {
    ids.add(tabId)
  }
  if (context?.session?.sessionId) {
    ids.add(structuredAgentSessionTabId(context.session.sessionId))
  }
}

let cachedInputs: WorkerTabInputs | null = null
let cachedIds: ReadonlySet<string> = EMPTY_IDS

/** Tab ids (terminal and structured-chat) that belong to orchestration workers. */
export function selectWorkerTabIds(state: WorkerTabInputs): ReadonlySet<string> {
  if (
    cachedInputs &&
    cachedInputs.agentStatusByPaneKey === state.agentStatusByPaneKey &&
    cachedInputs.runtimeAgentOrchestrationByPaneKey === state.runtimeAgentOrchestrationByPaneKey &&
    cachedInputs.retainedAgentsByPaneKey === state.retainedAgentsByPaneKey
  ) {
    return cachedIds
  }
  const ids = new Set<string>()
  for (const [paneKey, context] of Object.entries(state.runtimeAgentOrchestrationByPaneKey ?? {})) {
    addWorker(ids, paneKey, context)
  }
  for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey ?? {})) {
    addWorker(ids, paneKey, entry.orchestration)
  }
  for (const [paneKey, retained] of Object.entries(state.retainedAgentsByPaneKey ?? {})) {
    addWorker(ids, paneKey, retained.entry.orchestration)
  }
  cachedInputs = {
    agentStatusByPaneKey: state.agentStatusByPaneKey,
    runtimeAgentOrchestrationByPaneKey: state.runtimeAgentOrchestrationByPaneKey,
    retainedAgentsByPaneKey: state.retainedAgentsByPaneKey
  }
  cachedIds = ids.size > 0 ? ids : EMPTY_IDS
  return cachedIds
}

// Renderer-session only: a reload hides worker tabs again until they are opened.
const revealedWorkerTabIds = new Set<string>()
let revealedVersion = 0
const revealListeners = new Set<() => void>()

export function revealWorkerTab(tabId: string): void {
  if (revealedWorkerTabIds.has(tabId)) {
    return
  }
  revealedWorkerTabIds.add(tabId)
  revealedVersion += 1
  for (const listener of revealListeners) {
    listener()
  }
}

function subscribeRevealed(listener: () => void): () => void {
  revealListeners.add(listener)
  return () => revealListeners.delete(listener)
}

const readRevealedVersion = (): number => revealedVersion

/** Worker tabs the strip hides now, read outside React (e.g. bulk close). */
export function hiddenWorkerTabIds(state: WorkerTabInputs): ReadonlySet<string> {
  const workers = selectWorkerTabIds(state)
  if (workers.size === 0 || revealedWorkerTabIds.size === 0) {
    return workers
  }
  return new Set([...workers].filter((id) => !revealedWorkerTabIds.has(id)))
}

/** Same as hiddenWorkerTabIds, re-rendering when workers appear or a worker tab is revealed. */
export function useHiddenWorkerTabIds(): ReadonlySet<string> {
  const workers = useAppStore(selectWorkerTabIds)
  const version = useSyncExternalStore(subscribeRevealed, readRevealedVersion, readRevealedVersion)
  return useMemo(() => {
    void version
    return workers.size === 0 || revealedWorkerTabIds.size === 0
      ? workers
      : new Set([...workers].filter((id) => !revealedWorkerTabIds.has(id)))
  }, [workers, version])
}

export function resetRevealedWorkerTabsForTests(): void {
  revealedWorkerTabIds.clear()
  revealedVersion = 0
  cachedInputs = null
  cachedIds = EMPTY_IDS
}
