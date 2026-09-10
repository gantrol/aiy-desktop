CREATE TABLE social_post_save_receipts (
  request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES social_post_drafts(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES social_post_revisions(id) ON DELETE CASCADE,
  created_revision INTEGER NOT NULL CHECK(created_revision IN (0, 1))
);
CREATE INDEX idx_social_post_save_receipts_post ON social_post_save_receipts(post_id);
