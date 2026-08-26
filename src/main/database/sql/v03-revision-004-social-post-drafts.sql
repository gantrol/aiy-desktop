CREATE TABLE social_post_drafts (
  id TEXT PRIMARY KEY,
  album_id TEXT REFERENCES albums(id),
  source_inspiration_stash_id TEXT REFERENCES inspiration_stashes(id),
  current_revision_id TEXT REFERENCES social_post_revisions(id),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT
);

CREATE TABLE social_post_revisions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES social_post_drafts(id),
  revision_no INTEGER NOT NULL CHECK(revision_no > 0),
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(draft_id, revision_no)
);

CREATE INDEX idx_social_post_drafts_location
ON social_post_drafts(status, album_id, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_social_post_revisions_draft
ON social_post_revisions(draft_id, revision_no DESC);
