import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentSessionLineageEntry } from '../../../shared/agent-session-fork'
import { JOURNAL_DB_SCHEMA_VERSION } from './journal-database-schema'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from './journal-host-database-test-support'
import { AgentSessionLineageTable } from './agent-session-lineage-table'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orca-lineage-'))
})

afterEach(() => {
  closeTestJournalHostDatabase(directory)
  rmSync(directory, { recursive: true, force: true })
})

const entry = (
  childSessionId: string,
  sourceSessionId = 'claude_source_chat'
): AgentSessionLineageEntry => ({
  childSessionId,
  sourceSessionId,
  originSessionId: sourceSessionId,
  mode: 'native',
  cut: {
    journalItemId: 'item-4',
    journalEpoch: 'epoch-1',
    journalSequence: 4,
    messageCount: 4,
    providerSessionId: 'provider-source',
    providerMessageId: 'uuid-4'
  },
  sourceProvider: 'claude',
  createdAt: 1_793_000_000_000
})

describe('fork lineage in the chat journal database', () => {
  it('keeps every child of one source across a reopen, without changing the database version', () => {
    const table = new AgentSessionLineageTable(openTestJournalHostDatabase(directory))
    expect(table.list()).toEqual([])
    table.put(entry('claude_child_one'))
    table.put(entry('claude_child_two'))
    closeTestJournalHostDatabase(directory)

    const reopened = openTestJournalHostDatabase(directory)
    const again = new AgentSessionLineageTable(reopened)
    expect(again.list().map((row) => row.childSessionId)).toEqual([
      'claude_child_one',
      'claude_child_two'
    ])
    expect(again.get('claude_child_two')?.cut.providerMessageId).toBe('uuid-4')
    // Why: an older build opens the same version and never reads the table, so a downgrade keeps chats.
    expect(reopened.db.pragma('user_version', { simple: true })).toBe(JOURNAL_DB_SCHEMA_VERSION)
  })

  it('drops a fork whose chat was refused, and skips rows this build cannot read', () => {
    const database = openTestJournalHostDatabase(directory)
    const table = new AgentSessionLineageTable(database)
    table.put(entry('claude_child_one'))
    table.put(entry('claude_child_two'))
    table.delete('claude_child_one')
    database.db
      .prepare('INSERT INTO agent_session_lineage (child_session_id, entry_json) VALUES (?, ?)')
      .run(
        'claude_child_future',
        JSON.stringify({ childSessionId: 'claude_child_future', mode: 'teleport' })
      )
    expect(table.list().map((row) => row.childSessionId)).toEqual(['claude_child_two'])
    expect(table.get('claude_child_future')).toBeNull()
  })
})
