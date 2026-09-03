ALTER TABLE codex_history_index_meta
  ADD COLUMN source_history_id TEXT;

ALTER TABLE codex_history_index_meta
  ADD COLUMN source_history_row_id INTEGER NOT NULL DEFAULT 0
    CHECK (source_history_row_id >= 0);

ALTER TABLE codex_history_index_meta
  ADD COLUMN source_state_id TEXT;

ALTER TABLE codex_history_index_meta
  ADD COLUMN source_thread_updated_at_ms INTEGER NOT NULL DEFAULT 0
    CHECK (source_thread_updated_at_ms >= 0);

ALTER TABLE codex_history_index_meta
  ADD COLUMN source_thread_count INTEGER NOT NULL DEFAULT 0
    CHECK (source_thread_count >= 0);

ALTER TABLE codex_history_index_meta
  ADD COLUMN source_project_signature TEXT;

UPDATE codex_history_index_meta
SET source_signature = NULL,
    source_history_id = NULL,
    source_history_row_id = 0,
    source_state_id = NULL,
    source_thread_updated_at_ms = 0,
    source_thread_count = 0,
    source_project_signature = NULL
WHERE id = 1;
