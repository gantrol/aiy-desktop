-- Revision-1 project metadata fragment. Kept separate so private revision-1
-- caches can complete the consolidated public shape without rebuilding the index.
ALTER TABLE codex_history_threads
  ADD COLUMN project_id TEXT NOT NULL DEFAULT '';

ALTER TABLE codex_history_threads
  ADD COLUMN project_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS codex_history_threads_project_idx
  ON codex_history_threads (project_id, updated_at_ms DESC, thread_id);

UPDATE codex_history_index_meta
SET source_signature = NULL,
    indexed_at = NULL,
    indexed_threads = 0,
    indexed_messages = 0
WHERE id = 1;
