CREATE TABLE article_revision_packs (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  codec TEXT NOT NULL CHECK(codec = 'BROTLI_JSON_V1'),
  payload BLOB NOT NULL CHECK(typeof(payload) = 'blob' AND length(payload) > 0),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
  entry_count INTEGER NOT NULL CHECK(entry_count > 0),
  first_revision_no INTEGER NOT NULL CHECK(first_revision_no > 0),
  last_revision_no INTEGER NOT NULL CHECK(last_revision_no >= first_revision_no),
  uncompressed_bytes INTEGER NOT NULL CHECK(uncompressed_bytes > 0),
  compressed_bytes INTEGER NOT NULL CHECK(compressed_bytes = length(payload)),
  created_at TEXT NOT NULL,
  UNIQUE(article_id, first_revision_no, last_revision_no)
);

ALTER TABLE article_revisions
ADD COLUMN content_pack_id TEXT REFERENCES article_revision_packs(id);

ALTER TABLE article_revisions
ADD COLUMN content_pack_entry_index INTEGER CHECK(content_pack_entry_index IS NULL OR content_pack_entry_index >= 0);

CREATE UNIQUE INDEX idx_article_revision_pack_entry
ON article_revisions(content_pack_id, content_pack_entry_index)
WHERE content_pack_id IS NOT NULL;

CREATE INDEX idx_article_revision_packs_article_range
ON article_revision_packs(article_id, first_revision_no, last_revision_no);
