import Database from '../../../sqlite/sync-database'
import { attachOrchestrationDbMethods } from './attach-orchestration-db-methods'
import type { MailHandBack } from './messages/helper-mailbox-hand-back'
import { hardenOrchestrationDatabaseFiles } from './database-file-permissions'
import { backfillFederatedStubHomeRuns } from './federation/federated-stub-home-run-backfill'
import type { OrchestrationDbMethods } from './orchestration-db-methods'
import {
  createCoordinatorMailRoutingTrigger,
  createRunCoordinatorAddressTriggers,
  rememberCurrentRunCoordinatorHandles
} from './runs/run-coordinator-mail-routing'
import { createTables } from './schema/create-tables'
import { migrate } from './schema/migrate'
import { backfillStructuredWorkerOrcaSessionIds } from './schema/structured-worker-orca-session-backfill'
import { reconcileSettledWorkerDispatches } from './worker-dispatch/worker-dispatch-settlement'
import { pruneProjectFlowLogIfDue } from './project-flow/project-flow-log-store'

class OrchestrationDbCore {
  db: Database.Database

  // Why: the orchestration DB is created lazily for ALL users, but only the
  // small minority who dispatch work ever have dispatch_contexts rows. The
  // renderer graph publish rebuilds orchestration context on every 16ms tick
  // (buildAgentOrchestrationByPaneKey), issuing 2 queries per terminal. Cache
  // emptiness so the non-orchestration majority short-circuits the whole
  // per-terminal fan-out. Only createDispatchContext flips this false→true.
  hasAnyDispatchContextsCache: boolean | undefined
  localMutationCallerFingerprint: string | undefined
  // Why: in memory only; the re-armed rows themselves are what restart recovery reads.
  pendingMailHandBacks: MailHandBack[] = []
  /** The runtime's wake for mail a settlement handed to a Run, called once the transaction ends. */
  mailHandBackListener: ((handBack: MailHandBack) => void) | undefined
  /** When the flow log was last pruned; the log prunes itself when this is over an hour old. */
  projectFlowPrunedAt: number | undefined

  constructor(dbPath: (string & {}) | ':memory:') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    createTables.call(this as unknown as OrchestrationDb)
    migrate.call(this as unknown as OrchestrationDb)
    createRunCoordinatorAddressTriggers(this.db)
    backfillFederatedStubHomeRuns(this.db)
    backfillStructuredWorkerOrcaSessionIds(this.db)
    reconcileSettledWorkerDispatches(this.db)
    createCoordinatorMailRoutingTrigger.call(this as unknown as OrchestrationDb)
    rememberCurrentRunCoordinatorHandles.call(this as unknown as OrchestrationDb)
    hardenOrchestrationDatabaseFiles(dbPath)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the core is only ever constructed as the OrchestrationDb it is typed as, like the calls above.
    pruneProjectFlowLogIfDue.call(this as unknown as OrchestrationDb)
  }

  close(): void {
    this.db.close()
  }
}

export type OrchestrationDb = OrchestrationDbCore & OrchestrationDbMethods

attachOrchestrationDbMethods(OrchestrationDbCore)

// Why: attach adds methods on the prototype; oxlint forbids class/interface merging, so the construct type is asserted.
export const OrchestrationDb = OrchestrationDbCore as new (
  dbPath: (string & {}) | ':memory:'
) => OrchestrationDb
