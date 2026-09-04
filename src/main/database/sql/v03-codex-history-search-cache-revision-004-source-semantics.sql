ALTER TABLE codex_history_projects
  ADD COLUMN section_id TEXT NOT NULL DEFAULT '';

ALTER TABLE codex_history_projects
  ADD COLUMN section_position INTEGER
    CHECK (section_position IS NULL OR section_position >= 0);

CREATE INDEX IF NOT EXISTS codex_history_projects_section_idx
  ON codex_history_projects (section_id, section_position, position, project_id);

DELETE FROM codex_history_message_fts;
DELETE FROM codex_history_messages;
DELETE FROM codex_history_thread_fts;
DELETE FROM codex_history_threads;
DELETE FROM codex_history_projects;
DELETE FROM codex_history_sections;

UPDATE codex_history_index_meta
SET source_signature = NULL,
    source_history_id = NULL,
    source_history_row_id = 0,
    source_state_id = NULL,
    source_thread_updated_at_ms = 0,
    source_thread_count = 0,
    source_project_signature = NULL,
    indexed_at = NULL,
    indexed_threads = 0,
    indexed_messages = 0
WHERE id = 1;
