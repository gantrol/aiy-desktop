CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  album_id TEXT REFERENCES albums(id),
  source_inspiration_stash_id TEXT REFERENCES inspiration_stashes(id),
  current_revision_id TEXT REFERENCES article_revisions(id),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT
);

CREATE TABLE article_revisions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  revision_no INTEGER NOT NULL CHECK(revision_no > 0),
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(article_id, revision_no)
);

CREATE INDEX idx_articles_location
ON articles(status, album_id, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_article_revisions_article
ON article_revisions(article_id, revision_no DESC);
