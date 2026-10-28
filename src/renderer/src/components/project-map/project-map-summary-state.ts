// Which chats have a saved summary and which hosts cannot make one, for the menu, the node
// marker and the panel to share. Read from each chat's host; never written to disk here.

export type ProjectMapSummaryState = {
  /** Session ids with a saved summary. */
  summarized: ReadonlySet<string>
  /** Hosts known to predate summaries. */
  unsupportedHosts: ReadonlySet<string>
  /** The node whose summary panel is open. */
  openPaneKey: string | null
}

const NONE: ReadonlySet<string> = new Set()
let state: ProjectMapSummaryState = {
  summarized: NONE,
  unsupportedHosts: NONE,
  openPaneKey: null
}
const listeners = new Set<() => void>()

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value))
}

function publish(next: ProjectMapSummaryState): void {
  state = next
  listeners.forEach((listener) => listener())
}

export const projectMapSummaryState = (): ProjectMapSummaryState => state

export function subscribeToProjectMapSummaryState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setProjectMapSummaryIndex(
  summarized: ReadonlySet<string>,
  unsupportedHosts: ReadonlySet<string>
): void {
  if (
    sameMembers(summarized, state.summarized) &&
    sameMembers(unsupportedHosts, state.unsupportedHosts)
  ) {
    return
  }
  publish({ ...state, summarized, unsupportedHosts })
}

export function noteProjectMapSummary(sessionId: string, exists: boolean): void {
  if (state.summarized.has(sessionId) === exists) {
    return
  }
  const summarized = new Set(state.summarized)
  if (exists) {
    summarized.add(sessionId)
  } else {
    summarized.delete(sessionId)
  }
  publish({ ...state, summarized })
}

export function openProjectMapSummary(paneKey: string | null): void {
  if (state.openPaneKey !== paneKey) {
    publish({ ...state, openPaneKey: paneKey })
  }
}
