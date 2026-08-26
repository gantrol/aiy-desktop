CREATE TABLE inspiration_stashes (
  id TEXT PRIMARY KEY,
  album_id TEXT REFERENCES albums(id),
  input_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT
);

CREATE INDEX idx_inspiration_stashes_location
ON inspiration_stashes(status, album_id, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_inspiration_stashes_content
ON inspiration_stashes(content_hash, album_id)
WHERE status = 'ACTIVE' AND deleted_at IS NULL;
