CREATE TABLE IF NOT EXISTS codex_content_preferences (
  stash_id TEXT PRIMARY KEY REFERENCES inspiration_stashes(id) ON DELETE CASCADE,
  project_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS codex_content_tasks (
  id TEXT PRIMARY KEY,
  stash_id TEXT NOT NULL REFERENCES inspiration_stashes(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  task_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  outputs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS codex_content_tasks_source ON codex_content_tasks(stash_id, created_at DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS codex_content_tasks_active ON codex_content_tasks(stash_id)
  WHERE status IN ('STARTING', 'RUNNING', 'COLLECTING');
