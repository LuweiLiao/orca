import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../../shared/structured-agent-session-projection'
import type {
  ProjectFlowEndpoint,
  ProjectFlowEvent,
  ProjectFlowKind
} from '../../../../shared/project-flow-event'
import type { FlowSignal, FlowSignalBus, FlowSignalTone } from './project-flow-signal'

/** What this window already knows about the ends a host named. */
export type FlowLookup = {
  paneOfDispatch: (dispatchId: string) => string | null
  coordinatorPaneOfDispatch: (dispatchId: string) => string | null
  workspaceOfPullRequest: (repoId: string, prNumber: number) => string | null
  parentWorkspaceOf: (workspaceId: string) => string | null
}

const HOLD_MS = 2_000
const MAX_HELD = 32

function sessionPaneKey(sessionId: string | undefined): string | null {
  return sessionId
    ? structuredAgentSessionPaneKey(structuredAgentSessionTabId(sessionId), sessionId)
    : null
}

function resolveEndpoint(endpoint: ProjectFlowEndpoint, lookup: FlowLookup): string | null {
  switch (endpoint.kind) {
    case 'worker':
      return lookup.paneOfDispatch(endpoint.dispatchId) ?? sessionPaneKey(endpoint.sessionId)
    case 'coordinator':
      return (
        lookup.coordinatorPaneOfDispatch(endpoint.dispatchId) ?? sessionPaneKey(endpoint.sessionId)
      )
    case 'pane':
      return endpoint.paneKey
    case 'session':
      return sessionPaneKey(endpoint.sessionId)
    case 'workspace':
      return endpoint.workspaceId
    case 'pull-request':
      return lookup.workspaceOfPullRequest(endpoint.repoId, endpoint.prNumber)
    case 'pull-request-base': {
      const head = lookup.workspaceOfPullRequest(endpoint.repoId, endpoint.prNumber)
      return head ? lookup.parentWorkspaceOf(head) : null
    }
  }
}

function toneOf(flow: ProjectFlowKind, outcome: ProjectFlowEvent['outcome']): FlowSignalTone {
  if (flow === 'report') {
    return outcome === 'failed' ? 'failure' : 'success'
  }
  return flow
}

/** The signal a host's event means here, or null while one of its ends is not known yet. */
export function resolveProjectFlowEvent(
  event: ProjectFlowEvent,
  lookup: FlowLookup
): FlowSignal | null {
  const from = resolveEndpoint(event.from, lookup)
  const to = resolveEndpoint(event.to, lookup)
  return from && to ? { id: event.id, from, to, tone: toneOf(event.flow, event.outcome) } : null
}

export type ProjectFlowIntake = {
  /** `local` is this machine's own host, whose view of the world this window can refresh. */
  accept: (event: ProjectFlowEvent, source?: 'local' | 'remote') => void
  /** Tries the events held for an end that was not known yet; call when what is known changed. */
  retry: () => void
}

/**
 * A host can name a worker before this window has heard of it, so an event whose end is unknown
 * is held for a moment and dropped after that, never flown to a guess. This machine's own host
 * is asked to say what it knows now: a chat given a second task has no other reason to tell this
 * window until its turn starts, which can be long after the task was handed over.
 */
export function createProjectFlowIntake(
  bus: FlowSignalBus,
  lookup: () => FlowLookup,
  now: () => number = Date.now,
  requestRefresh: () => void = () => {}
): ProjectFlowIntake {
  let held: { event: ProjectFlowEvent; expiresAt: number }[] = []
  const settle = (event: ProjectFlowEvent): boolean => {
    const signal = resolveProjectFlowEvent(event, lookup())
    if (signal) {
      bus.publish(signal)
    }
    return signal !== null
  }
  return {
    accept: (event, source = 'remote') => {
      if (!settle(event)) {
        held = [...held, { event, expiresAt: now() + HOLD_MS }].slice(-MAX_HELD)
        if (source === 'local') {
          requestRefresh()
        }
      }
    },
    retry: () => {
      if (held.length === 0) {
        return
      }
      const at = now()
      held = held.filter((entry) => entry.expiresAt > at && !settle(entry.event))
    }
  }
}
