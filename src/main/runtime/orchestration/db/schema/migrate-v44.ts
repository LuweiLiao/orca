import type { OrchestrationDb } from '../orchestration-db'
import { AGENT_DELEGATION_GRANT_TABLES_SQL } from '../delegation-grants/agent-delegation-grant-store'

/**
 * User authorizations for agent creation and what spent them. New tables only, so a downgraded
 * build ignores them; `createTables` declares them too, as it does every table.
 */
export function migrateV44(this: OrchestrationDb, current: number): void {
  if (current >= 44) {
    return
  }
  this.db.exec(AGENT_DELEGATION_GRANT_TABLES_SQL)
}
