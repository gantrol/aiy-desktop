CREATE TABLE IF NOT EXISTS usage_chat_turns (
  source_session_id TEXT NOT NULL REFERENCES usage_source_files(session_id) ON DELETE CASCADE,
  turn_order INTEGER NOT NULL,
  turn_id TEXT NOT NULL,
  started_ms INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  terminal_ms INTEGER,
  terminal_at TEXT,
  terminal_state TEXT CHECK (terminal_state IN ('COMPLETED', 'ABORTED')),
  PRIMARY KEY (source_session_id, turn_id)
) STRICT;

CREATE INDEX IF NOT EXISTS usage_chat_turns_owner_idx
  ON usage_chat_turns (turn_id, started_ms, source_session_id);

CREATE INDEX IF NOT EXISTS usage_chat_turns_session_terminal_idx
  ON usage_chat_turns (source_session_id, terminal_ms, turn_order);

CREATE INDEX IF NOT EXISTS usage_events_session_turn_idx
  ON usage_events (source_session_id, turn_id, event_order);

DELETE FROM usage_processed_cache;
DELETE FROM session_analysis_cache;
DELETE FROM scan_tasks;
DELETE FROM usage_events;
DELETE FROM usage_source_files;

UPDATE usage_ingestion_meta
SET data_revision = data_revision + 1
WHERE id = 1;
