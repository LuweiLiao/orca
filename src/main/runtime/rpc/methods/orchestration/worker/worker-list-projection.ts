import {
  ORCHESTRATION_FLEET_PAGE_MAX,
  projectOrchestrationFleet,
  type FleetDurableWorker,
  type OrchestrationFleetWorker
} from '../../../../../../shared/orchestration-fleet-projection'
import { resolveFleetWorkerOutcome } from '../../../../../../shared/orchestration-fleet-outcome-resolution'
import type { WorkerTerminalListState } from '../../../../orchestration/worker-terminal-ownership'
import type { OrchestrationDb } from '../../../../orchestration/db'
import { chatAssigneeSessionId } from '../../../../orchestration/chat-assignee'
import type { SessionWorkerObservation } from './session-worker-observation'
import { refreshFleetWorkerVerdict } from '../federation/federated-fleet-snapshot'

export type WorkerListPageParams = {
  run?: string
  terminalState?: WorkerTerminalListState
  includeRemote?: boolean
  paginate?: boolean
}

export function projectWorkerFleet(args: {
  rows: ReturnType<OrchestrationDb['listWorkerTerminalResources']>
  attentionFacts: ReturnType<OrchestrationDb['getWorkerAttentionFactsForDispatches']>
  statuses: Parameters<typeof projectOrchestrationFleet>[0]['statuses']
  limit: number
  now: number
  completeProjection?: boolean
  /** A chat or structured worker's verdict; no agent-status row binds a session without a PTY. */
  observeSession?: (dispatchId: string, terminalHandle: string) => SessionWorkerObservation | null
}) {
  const workers: FleetDurableWorker[] = args.rows.map((row) => {
    return {
      ...row,
      outcome: resolveFleetWorkerOutcome({
        attemptOutcome: args.attentionFacts.get(row.dispatchId)?.outcome ?? 'outcome_unknown',
        workerState: row.workerState,
        dispatchStatus: row.dispatchStatus
      }),
      resource: row.resource
        ? {
            id: row.resource.id,
            ownerDispatchId: row.resource.owner_dispatch_id,
            worktreeId: row.resource.worktree_id,
            paneKey: row.resource.pane_key,
            processIncarnation: row.resource.process_incarnation,
            endpointId: row.resource.endpoint_id,
            endpointIncarnation: row.resource.endpoint_incarnation,
            hostScope: row.resource.host_scope,
            ownershipState: row.resource.ownership_state,
            releaseState: row.resource.release_state,
            updatedAt: row.resource.updated_at
          }
        : null
    }
  })
  const durable = new Map(workers.map((worker) => [worker.dispatchId, worker]))
  if (!args.completeProjection) {
    const fleet = {
      ...projectOrchestrationFleet({
        workers,
        statuses: args.statuses,
        limit: args.limit,
        now: args.now
      }),
      durable
    }
    applySessionWorkerLiveness(fleet, args.observeSession, args.now)
    return fleet
  }

  const projections: ReturnType<typeof projectOrchestrationFleet>['workers'] = []
  for (let offset = 0; offset < workers.length; offset += ORCHESTRATION_FLEET_PAGE_MAX) {
    projections.push(
      ...projectOrchestrationFleet({
        workers: workers.slice(offset, offset + ORCHESTRATION_FLEET_PAGE_MAX),
        statuses: args.statuses,
        limit: ORCHESTRATION_FLEET_PAGE_MAX,
        now: args.now
      }).workers
    )
  }
  const fleet = {
    workers: projections,
    page: { limit: workers.length, total: workers.length, hasMore: false, nextCursor: null },
    durable
  }
  applySessionWorkerLiveness(fleet, args.observeSession, args.now)
  return fleet
}

/** Read off the session records, as worker-show and mail read it: at rest is live, closed exited. */
function applySessionWorkerLiveness(
  fleet: { workers: OrchestrationFleetWorker[]; durable: ReadonlyMap<string, FleetDurableWorker> },
  observeSession:
    | ((dispatchId: string, terminalHandle: string) => SessionWorkerObservation | null)
    | undefined,
  now: number
): void {
  for (const worker of observeSession ? fleet.workers : []) {
    const handle = fleet.durable.get(worker.dispatchId)?.agentTerminalHandle
    // A durable death certificate (a stop, a release) outranks a read of the records.
    if (!handle || !observeSession || worker.liveness.verdict === 'exited') {
      continue
    }
    const observed = observeSession(worker.dispatchId, handle)
    // A structured worker the records cannot prove keeps the fleet's own verdict.
    if (
      !observed ||
      observed.status === 'identity_changed' ||
      (observed.status === 'unverifiable' && !chatAssigneeSessionId(handle))
    ) {
      continue
    }
    worker.liveness =
      observed.status === 'live'
        ? { verdict: 'live', observedAt: now, source: 'execution_host' }
        : observed.status === 'exited'
          ? { verdict: 'exited', source: 'execution_host' }
          : { verdict: 'unverifiable', reason: 'host_unavailable' }
    worker.evidence.liveStatus = observed.status === 'live' ? 'fresh' : 'unavailable'
    worker.evidence.lastObservedAt = observed.status === 'live' ? now : null
    refreshFleetWorkerVerdict(worker, fleet.durable)
  }
}
