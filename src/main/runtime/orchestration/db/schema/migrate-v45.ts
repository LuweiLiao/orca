import type { OrchestrationDb } from '../orchestration-db'
import { PROJECT_FLOW_LOG_TABLES_SQL } from '../project-flow/project-flow-log-tables'

/** The append-only flow log. A new table only, so a downgraded build ignores it. */
export function migrateV45(this: OrchestrationDb, current: number): void {
  if (current >= 45) {
    return
  }
  this.db.exec(PROJECT_FLOW_LOG_TABLES_SQL)
}
