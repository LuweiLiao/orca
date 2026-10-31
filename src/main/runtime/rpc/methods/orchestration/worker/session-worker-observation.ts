import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { chatAssigneeSessionId, observeChatAssignee } from '../../../../orchestration/chat-assignee'
import type { OrchestrationDb } from '../../../../orchestration/db'
import {
  holdStructuredWorker,
  observeStructuredSession
} from '../../../../structured-worker-authority'
import { resolveStructuredWorkerForDispatch } from '../../orchestration-structured-worker-lifecycle'
import { isStructuredWorkerHandle } from '../../../../../../shared/structured-worker-handle'

export type SessionWorkerObservation = {
  terminal: null
  exact: boolean
  status: 'identity_changed' | 'live' | 'exited' | 'unverifiable'
  reason?: string
  addressable?: boolean
  terminalHandle: null
}

/** Read session records for structured/chat workers; null selects the PTY path. */
export function observeSessionWorker(
  db: OrchestrationDb,
  dispatchId: string,
  terminalHandle: string
): SessionWorkerObservation | null {
  const chat = chatAssigneeSessionId(terminalHandle)
  if (chat) {
    const observed = observeChatAssignee(chat, db)
    return {
      terminal: null,
      exact: true,
      status: observed.status,
      ...(observed.status === 'unverifiable' ? { reason: observed.reason } : {}),
      terminalHandle: null
    }
  }
  const structured = isStructuredWorkerHandle(terminalHandle)
    ? resolveStructuredWorkerForDispatch(db, dispatchId)
    : null
  if (!structured) {
    return null
  }
  // Structured registry proves pane/lineage identity without a PTY.
  // Omit agentWait: terminal scans cannot see journal questions, and null falsely claims no wait.
  const exact = db.isDispatchProcessCurrent({
    dispatchId,
    paneKey: structured.paneKey,
    processIncarnation: structured.processIncarnation
  })
  // One lineage walk, so status and `addressable` judge the same session even mid-`/clear`.
  const hold = holdStructuredWorker(structured, db)
  const observation =
    hold.kind === 'unverifiable'
      ? { status: 'unverifiable' as const, reason: hold.reason }
      : observeStructuredSession(hold.running.sessionId)
  const addressable = hold.kind === 'unverifiable' ? null : hold.kind === 'held'
  return {
    terminal: null,
    exact,
    status: exact ? observation.status : 'identity_changed',
    ...(exact && observation.reason ? { reason: observation.reason } : {}),
    ...(exact && addressable !== null ? { addressable } : {}),
    terminalHandle: null
  }
}

/** As observeSessionWorker, after installing the host records a restart leaves uninstalled. */
export async function inspectSessionWorker(
  runtime: Pick<OrcaRuntimeService, 'ensureStructuredAgentSessionHost'>,
  db: OrchestrationDb,
  dispatchId: string,
  terminalHandle: string
): Promise<SessionWorkerObservation | null> {
  if (chatAssigneeSessionId(terminalHandle)) {
    await runtime.ensureStructuredAgentSessionHost().catch(() => undefined)
  }
  return observeSessionWorker(db, dispatchId, terminalHandle)
}

/** A fleet page's session-worker verdicts, read off records a restart leaves uninstalled. */
export async function sessionWorkerObserver(
  runtime: Pick<OrcaRuntimeService, 'ensureStructuredAgentSessionHost'>,
  db: OrchestrationDb,
  rows: readonly { agentTerminalHandle: string | null }[]
): Promise<(dispatchId: string, terminalHandle: string) => SessionWorkerObservation | null> {
  if (
    rows.some(
      (row) =>
        chatAssigneeSessionId(row.agentTerminalHandle) ||
        isStructuredWorkerHandle(row.agentTerminalHandle)
    )
  ) {
    await runtime.ensureStructuredAgentSessionHost().catch(() => undefined)
  }
  return (dispatchId, terminalHandle) => observeSessionWorker(db, dispatchId, terminalHandle)
}
