ALTER TABLE codex_history_threads
  ADD COLUMN section_id TEXT NOT NULL DEFAULT '';

ALTER TABLE codex_history_threads
  ADD COLUMN section_name TEXT NOT NULL DEFAULT '';

ALTER TABLE codex_history_threads
  ADD COLUMN section_position INTEGER
    CHECK (section_position IS NULL OR section_position >= 0);

ALTER TABLE codex_history_threads
  ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
    CHECK (pinned IN (0, 1));

CREATE INDEX IF NOT EXISTS codex_history_threads_section_idx
  ON codex_history_threads (section_id, section_position, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS codex_history_projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS codex_history_projects_position_idx
  ON codex_history_projects (position, name, project_id);

CREATE TABLE IF NOT EXISTS codex_history_sections (
  section_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS codex_history_sections_position_idx
  ON codex_history_sections (position, name, section_id);

UPDATE codex_history_index_meta
SET source_signature = NULL,
    source_project_signature = NULL
WHERE id = 1;
