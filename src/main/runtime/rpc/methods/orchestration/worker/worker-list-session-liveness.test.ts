import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../../../orchestration/db'
import { projectWorkerFleet } from './worker-list-projection'
import type { SessionWorkerObservation } from './session-worker-observation'

describe('worker-list liveness for a structured worker', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  function project(status: SessionWorkerObservation['status'] | null) {
    db?.close()
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'draw parts',
      coordinatorHandle: 'term-coordinator',
      coordinatorPaneKey: 'tab-coordinator:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = db.createTask({ spec: 'draw', runId: run.id })
    const sqlite = db.db
    sqlite
      .prepare(
        `INSERT INTO dispatch_contexts (id, run_id, task_id, assignee_handle, status, created_at)
         VALUES ('ctx_draw', ?, ?, 'structworker_draw', 'dispatched', '2026-10-30 05:02:31')`
      )
      .run(run.id, task.id)
    sqlite
      .prepare(
        `INSERT INTO worker_dispatches (dispatch_id, state, stage, agent_terminal_handle)
         VALUES ('ctx_draw', 'ready', 'ready', 'structworker_draw')`
      )
      .run()
    const now = Date.now()
    const seen: string[] = []
    const fleet = projectWorkerFleet({
      rows: db.listWorkerTerminalResources({ runId: run.id }),
      attentionFacts: db.getWorkerAttentionFactsForDispatches(['ctx_draw'], now),
      statuses: [],
      limit: 10,
      now,
      observeSession: (dispatchId, handle) => {
        seen.push(`${dispatchId}:${handle}`)
        return status === null
          ? null
          : { terminal: null, exact: true, status, terminalHandle: null }
      }
    })
    expect(seen).toEqual(['ctx_draw:structworker_draw'])
    return fleet.workers[0]!.liveness
  }

  // No agent-status row binds a session without a PTY, so the session records stand in.
  it('reads live off the session records', () => {
    expect(project('live')).toMatchObject({ verdict: 'live', source: 'execution_host' })
  })

  it('keeps the fleet verdict when the records cannot prove the session', () => {
    expect(project('unverifiable')).toEqual({ verdict: 'unverifiable', reason: 'missing_status' })
    expect(project(null)).toEqual({ verdict: 'unverifiable', reason: 'missing_status' })
  })
})
