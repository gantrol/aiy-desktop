CREATE TABLE article_delivery_jobs (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  extension_id TEXT NOT NULL CHECK(length(trim(extension_id)) > 0),
  channel_id TEXT NOT NULL CHECK(length(trim(channel_id)) > 0),
  space_id TEXT NOT NULL CHECK(length(trim(space_id)) > 0),
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  article_revision_id TEXT NOT NULL REFERENCES article_revisions(id) ON DELETE RESTRICT,
  article_content_hash TEXT NOT NULL CHECK(
    length(article_content_hash) = 64
    AND article_content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  target_slug TEXT NOT NULL CHECK(length(trim(target_slug)) > 0),
  target_description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  error_message TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0, 1)),
  retry_of_job_id TEXT REFERENCES article_delivery_jobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) > 0)
);

CREATE INDEX idx_article_delivery_jobs_article_created
ON article_delivery_jobs(space_id, article_id, created_at DESC, id DESC);

CREATE INDEX idx_article_delivery_jobs_queue
ON article_delivery_jobs(status, created_at, id);
