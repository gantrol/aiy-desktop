-- Revision-6 turn-speed fragment. Kept separate so private revision-6
-- caches can complete the consolidated public shape without replaying tables.
DROP TABLE IF EXISTS usage_chat_turns;

CREATE TABLE usage_chat_turns (
  source_session_id TEXT NOT NULL REFERENCES usage_source_files(session_id) ON DELETE CASCADE,
  turn_order INTEGER NOT NULL,
  turn_id TEXT NOT NULL,
  started_ms INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  terminal_ms INTEGER,
  terminal_at TEXT,
  terminal_state TEXT CHECK (terminal_state IN ('COMPLETED', 'ABORTED')),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  model TEXT,
  reasoning_effort TEXT,
  service_tier TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (service_tier IN ('STANDARD', 'FAST', 'UNKNOWN')),
  PRIMARY KEY (source_session_id, turn_id)
) STRICT;

CREATE INDEX usage_chat_turns_owner_idx
  ON usage_chat_turns (turn_id, started_ms, source_session_id);

CREATE INDEX usage_chat_turns_session_terminal_idx
  ON usage_chat_turns (source_session_id, terminal_ms, turn_order);

CREATE INDEX usage_chat_turns_speed_idx
  ON usage_chat_turns (terminal_state, terminal_ms, model, reasoning_effort, service_tier);

DELETE FROM usage_processed_cache;
DELETE FROM session_analysis_cache;
DELETE FROM usage_events;
DELETE FROM usage_source_files;

UPDATE usage_ingestion_meta
SET data_revision = data_revision + 1
WHERE id = 1;
