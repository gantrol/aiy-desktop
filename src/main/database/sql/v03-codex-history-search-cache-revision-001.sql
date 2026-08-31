CREATE TABLE IF NOT EXISTS codex_history_index_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_signature TEXT,
  indexed_at TEXT,
  indexed_threads INTEGER NOT NULL DEFAULT 0,
  indexed_messages INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT OR IGNORE INTO codex_history_index_meta (
  id,
  source_signature,
  indexed_at,
  indexed_threads,
  indexed_messages
) VALUES (1, NULL, NULL, 0, 0);

CREATE TABLE IF NOT EXISTS codex_history_threads (
  row_id INTEGER PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_available INTEGER NOT NULL CHECK (title_available IN (0, 1)),
  workspace TEXT NOT NULL,
  branch TEXT NOT NULL,
  archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
  thread_source TEXT NOT NULL CHECK (thread_source IN ('USER', 'SUBAGENT', 'OTHER')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  preview TEXT NOT NULL,
  metadata_text TEXT NOT NULL,
  search_text TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS codex_history_threads_updated_idx
  ON codex_history_threads (updated_at_ms DESC, thread_id);
CREATE INDEX IF NOT EXISTS codex_history_threads_filters_idx
  ON codex_history_threads (thread_source, archived, updated_at_ms DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS codex_history_thread_fts USING fts5(
  metadata_text,
  tokenize = 'trigram'
);

CREATE TABLE IF NOT EXISTS codex_history_messages (
  row_id INTEGER PRIMARY KEY,
  source_row_id INTEGER NOT NULL UNIQUE,
  thread_id TEXT NOT NULL REFERENCES codex_history_threads(thread_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  created_at_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  search_text TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS codex_history_messages_thread_idx
  ON codex_history_messages (thread_id, created_at_ms DESC, row_id DESC);
CREATE INDEX IF NOT EXISTS codex_history_messages_role_idx
  ON codex_history_messages (role, created_at_ms DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS codex_history_message_fts USING fts5(
  text,
  tokenize = 'trigram'
);
