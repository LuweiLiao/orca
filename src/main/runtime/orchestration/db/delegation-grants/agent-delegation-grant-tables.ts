/** Grants survive Run resets so they cannot replenish an agent allowance. */
export const AGENT_DELEGATION_GRANT_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS agent_delegation_grants (
  id                TEXT PRIMARY KEY,
  authorization_id  TEXT NOT NULL,
  holder_key        TEXT NOT NULL,
  source_key        TEXT NOT NULL UNIQUE,
  source_message_id TEXT,
  agent             TEXT NOT NULL,
  model             TEXT,
  effort            TEXT,
  count             INTEGER NOT NULL CHECK (count >= 1),
  task              TEXT NOT NULL DEFAULT '',
  run_id            TEXT,
  superseded_by     TEXT,
  -- 1 until the message carrying the cards reached the agent; a send can be refused or queued.
  awaiting_delivery INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_delegation_grants_holder
  ON agent_delegation_grants(holder_key, superseded_by);
CREATE TABLE IF NOT EXISTS agent_delegation_slots (
  id          TEXT PRIMARY KEY,
  grant_id    TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_delegation_slots_grant ON agent_delegation_slots(grant_id);
CREATE TABLE IF NOT EXISTS agent_delegation_slot_dispatches (
  dispatch_id  TEXT PRIMARY KEY,
  slot_id      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_delegation_slot_dispatches_slot
  ON agent_delegation_slot_dispatches(slot_id);
`
