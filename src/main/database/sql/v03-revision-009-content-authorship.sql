ALTER TABLE creation_authors ADD COLUMN kind TEXT CHECK(kind IN ('HUMAN', 'AI'));
ALTER TABLE creation_authors ADD COLUMN application TEXT;
CREATE UNIQUE INDEX idx_creation_authors_application ON creation_authors(application) WHERE application IS NOT NULL;

CREATE TABLE content_authorships (
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  PRIMARY KEY(target_type, target_id)
);
CREATE TABLE content_authors (
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES creation_authors(id),
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  PRIMARY KEY(target_type, target_id, author_id),
  FOREIGN KEY(target_type, target_id) REFERENCES content_authorships(target_type, target_id)
);
CREATE INDEX idx_content_authors_author ON content_authors(author_id, target_type, target_id);

-- Unresolved container credits are suggestions only, never current authors.
CREATE TABLE content_authorship_legacy (
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES creation_authors(id),
  PRIMARY KEY(target_type, target_id),
  FOREIGN KEY(target_type, target_id) REFERENCES content_authorships(target_type, target_id)
);
CREATE TABLE authorship_migration_evidence (
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(scope_type, scope_id)
);
CREATE TABLE article_revision_context (
  revision_id TEXT PRIMARY KEY REFERENCES article_revisions(id),
  writer_author_id TEXT REFERENCES creation_authors(id),
  context_json TEXT NOT NULL
);
