// Which conversations each sent message referenced, beside the chats in the host's journal
// database. Created on first use like the lineage table, so an older build never reads it.

import {
  isAgentSessionReferenceLink,
  type AgentSessionReferenceLink
} from '../../../shared/agent-session-reference-link'
import type { JournalHostDatabase } from './journal-host-database'

const TABLE = 'agent_session_reference_link'
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${TABLE} (target_session_id TEXT NOT NULL, message_id TEXT NOT NULL, reference_uri TEXT NOT NULL, entry_json TEXT NOT NULL, PRIMARY KEY (target_session_id, message_id, reference_uri))`

export class AgentSessionReferenceLinkTable {
  private created = false

  constructor(private readonly database: JournalHostDatabase) {}

  /** Unreadable rows are skipped, so a newer build's entry never breaks this one's map. */
  list(): AgentSessionReferenceLink[] {
    if (!this.exists()) {
      return []
    }
    const links: AgentSessionReferenceLink[] = []
    for (const row of this.database.db
      .prepare(`SELECT entry_json AS json FROM ${TABLE} ORDER BY rowid`)
      .all()) {
      const link = parseLink(row.json)
      if (link) {
        links.push(link)
      }
    }
    return links
  }

  /** A replayed send records the same links again; the key keeps one of each. */
  put(links: readonly AgentSessionReferenceLink[]): void {
    if (links.length === 0) {
      return
    }
    if (this.database.readOnly) {
      throw new Error('A newer Orca owns this chat database, so this one cannot record references.')
    }
    this.database.transaction((db) => {
      if (!this.created) {
        db.prepare(CREATE_TABLE_SQL).run()
      }
      const insert = db.prepare(
        `INSERT OR REPLACE INTO ${TABLE} (target_session_id, message_id, reference_uri, entry_json) VALUES (?, ?, ?, ?)`
      )
      for (const link of links) {
        insert.run(link.targetSessionId, link.messageId, link.referenceUri, JSON.stringify(link))
      }
    })
    this.created = true
  }

  private exists(): boolean {
    if (!this.created) {
      this.created = Boolean(
        this.database.db
          .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(TABLE)
      )
    }
    return this.created
  }
}

function parseLink(json: unknown): AgentSessionReferenceLink | null {
  if (typeof json !== 'string') {
    return null
  }
  try {
    const value: unknown = JSON.parse(json)
    return isAgentSessionReferenceLink(value) ? value : null
  } catch {
    return null
  }
}

const tables = new WeakMap<JournalHostDatabase, AgentSessionReferenceLinkTable>()

export function agentSessionReferenceLinkTable(
  database: JournalHostDatabase
): AgentSessionReferenceLinkTable {
  let table = tables.get(database)
  if (!table) {
    table = new AgentSessionReferenceLinkTable(database)
    tables.set(database, table)
  }
  return table
}
