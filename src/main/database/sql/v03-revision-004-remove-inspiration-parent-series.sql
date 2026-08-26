-- The temporary parent_series_id relation predated CreationItem/CreationForm.
-- Composition is normalized before this fragment runs, so the stash keeps only
-- its denormalized album location for editor reads.

CREATE TABLE inspiration_stashes_revision_4_composition (
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

INSERT INTO inspiration_stashes_revision_4_composition (
  id, album_id, input_json, content_hash, status,
  created_at, updated_at, archived_at, deleted_at
)
SELECT
  id, album_id, input_json, content_hash, status,
  created_at, updated_at, archived_at, deleted_at
FROM inspiration_stashes;

DROP TABLE inspiration_stashes;
ALTER TABLE inspiration_stashes_revision_4_composition RENAME TO inspiration_stashes;

CREATE INDEX idx_inspiration_stashes_location
ON inspiration_stashes(status, album_id, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_inspiration_stashes_content
ON inspiration_stashes(content_hash, album_id)
WHERE status = 'ACTIVE' AND deleted_at IS NULL;
