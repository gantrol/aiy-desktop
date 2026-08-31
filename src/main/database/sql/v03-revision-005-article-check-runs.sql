CREATE TABLE article_check_runs (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  input_revision_id TEXT NOT NULL REFERENCES article_revisions(id) ON DELETE CASCADE,
  article_title TEXT NOT NULL CHECK(length(article_title) <= 200),
  locale TEXT NOT NULL CHECK(locale IN ('zh', 'en')),
  provider_key TEXT NOT NULL CHECK(length(trim(provider_key)) > 0),
  requested_model TEXT NOT NULL CHECK(length(trim(requested_model)) > 0),
  reasoning_effort TEXT NOT NULL CHECK(reasoning_effort IN (
    'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'
  )),
  status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED')),
  finding_count INTEGER CHECK(finding_count IS NULL OR finding_count >= 0),
  result_json TEXT CHECK(
    result_json IS NULL OR (json_valid(result_json) AND json_type(result_json) = 'object')
  ),
  comment_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(
    json_valid(comment_ids_json) AND json_type(comment_ids_json) = 'array'
  ),
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL CHECK(length(trim(started_at)) > 0),
  finished_at TEXT,
  applied_at TEXT,
  CHECK(status = 'RUNNING' OR finished_at IS NOT NULL),
  CHECK(status <> 'RUNNING' OR finished_at IS NULL),
  CHECK(status <> 'SUCCEEDED' OR (finding_count IS NOT NULL AND result_json IS NOT NULL)),
  CHECK(status = 'SUCCEEDED' OR applied_at IS NULL),
  CHECK(status NOT IN ('FAILED', 'INTERRUPTED') OR error_code IS NOT NULL)
);

CREATE INDEX idx_article_check_runs_started
ON article_check_runs(started_at DESC, id DESC);

CREATE INDEX idx_article_check_runs_article_started
ON article_check_runs(article_id, started_at DESC, id DESC);

CREATE UNIQUE INDEX idx_article_check_runs_active_article
ON article_check_runs(article_id)
WHERE status = 'RUNNING';
