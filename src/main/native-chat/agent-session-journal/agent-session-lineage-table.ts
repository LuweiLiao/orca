// Which conversation each forked chat came from, beside the chats in the host's journal database.
//
// Created on first use rather than by a schema bump: an older build opens the same database at the
// same version and simply never reads this table, so installing an earlier Orca keeps every chat.

import {
  isAgentSessionLineageEntry,
  type AgentSessionLineageEntry
} from '../../../shared/agent-session-fork'
import type { JournalHostDatabase } from './journal-host-database'

const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS agent_session_lineage (child_session_id TEXT PRIMARY KEY, entry_json TEXT NOT NULL)'

export class AgentSessionLineageTable {
  private created = false

  constructor(private readonly database: JournalHostDatabase) {}

  /** Unreadable rows are skipped, so a newer build's entry never breaks this one's map. */
  list(): AgentSessionLineageEntry[] {
    if (!this.exists()) {
      return []
    }
    const entries: AgentSessionLineageEntry[] = []
    for (const row of this.database.db
      .prepare('SELECT entry_json AS json FROM agent_session_lineage ORDER BY rowid')
      .all()) {
      const entry = parseEntry(row.json)
      if (entry) {
        entries.push(entry)
      }
    }
    return entries
  }

  get(childSessionId: string): AgentSessionLineageEntry | null {
    if (!this.exists()) {
      return null
    }
    const row = this.database.db
      .prepare('SELECT entry_json AS json FROM agent_session_lineage WHERE child_session_id = ?')
      .get(childSessionId)
    return row ? parseEntry(row.json) : null
  }

  put(entry: AgentSessionLineageEntry): void {
    this.requireWritable()
    this.database.transaction((db) => {
      db.prepare(
        'INSERT OR REPLACE INTO agent_session_lineage (child_session_id, entry_json) VALUES (?, ?)'
      ).run(entry.childSessionId, JSON.stringify(entry))
    })
  }

  delete(childSessionId: string): void {
    this.requireWritable()
    this.database.transaction((db) => {
      db.prepare('DELETE FROM agent_session_lineage WHERE child_session_id = ?').run(childSessionId)
    })
  }

  private exists(): boolean {
    if (this.created) {
      return true
    }
    const row = this.database.db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('agent_session_lineage')
    this.created = Boolean(row)
    return this.created
  }

  private requireWritable(): void {
    if (this.database.readOnly) {
      throw new Error('A newer Orca owns this chat database, so this one cannot record a fork.')
    }
    if (!this.exists()) {
      this.database.transaction((db) => {
        db.prepare(CREATE_TABLE_SQL).run()
      })
      this.created = true
    }
  }
}

function parseEntry(json: unknown): AgentSessionLineageEntry | null {
  if (typeof json !== 'string') {
    return null
  }
  try {
    const value: unknown = JSON.parse(json)
    return isAgentSessionLineageEntry(value) ? value : null
  } catch {
    return null
  }
}

const tables = new WeakMap<JournalHostDatabase, AgentSessionLineageTable>()

/** One table object per open database, so its "created" cache is shared by every caller. */
export function agentSessionLineageTable(database: JournalHostDatabase): AgentSessionLineageTable {
  let table = tables.get(database)
  if (!table) {
    table = new AgentSessionLineageTable(database)
    tables.set(database, table)
  }
  return table
}
