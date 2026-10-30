/**
 * What happened between agents, as ids and ends only: never a task, report or message body.
 * AUTOINCREMENT keeps `seq` from repeating after old rows are pruned. A Run reset leaves it be.
 */
export const PROJECT_FLOW_LOG_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS project_flow_log (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NULL for rows that are not one named occurrence (state changes); UNIQUE ignores NULLs.
  event_id      TEXT UNIQUE,
  occurred_at   INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  from_endpoint TEXT,
  to_endpoint   TEXT,
  outcome       TEXT,
  run_id        TEXT,
  task_id       TEXT,
  dispatch_id   TEXT,
  stage         TEXT,
  worker_state  TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_flow_log_occurred ON project_flow_log(occurred_at);
`
