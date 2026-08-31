-- Revision-2 repair fragment for pre-release builds that created generation runs
-- before visual-only article generation was supported.

CREATE TABLE video_document_generation_runs_visual_input (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  branch_id TEXT NOT NULL REFERENCES document_branches(id),
  operation TEXT NOT NULL CHECK(operation = 'ARTICLE_GENERATE'),
  status TEXT NOT NULL CHECK(status IN (
    'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'BLOCKED', 'NOT_STARTED'
  )),
  input_revision_id TEXT REFERENCES document_draft_revisions(id),
  output_revision_id TEXT REFERENCES document_draft_revisions(id),
  provider_key TEXT NOT NULL CHECK(provider_key = 'codex'),
  requested_model TEXT NOT NULL CHECK(length(trim(requested_model)) BETWEEN 1 AND 200),
  actual_model TEXT CHECK(actual_model IS NULL OR length(trim(actual_model)) BETWEEN 1 AND 200),
  reasoning_effort TEXT NOT NULL CHECK(reasoning_effort = 'max'),
  usage_availability TEXT NOT NULL CHECK(usage_availability IN ('PROVIDED', 'MISSING', 'NOT_STARTED')),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens INTEGER CHECK(cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  reasoning_output_tokens INTEGER CHECK(reasoning_output_tokens IS NULL OR reasoning_output_tokens >= 0),
  total_tokens INTEGER CHECK(total_tokens IS NULL OR total_tokens >= 0),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  error_detail_json TEXT CHECK(error_detail_json IS NULL OR json_valid(error_detail_json)),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  CHECK(
    (status = 'RUNNING' AND output_revision_id IS NULL
      AND finished_at IS NULL AND usage_availability <> 'NOT_STARTED')
    OR (status = 'SUCCEEDED' AND output_revision_id IS NOT NULL
      AND error_code IS NULL AND finished_at IS NOT NULL AND usage_availability <> 'NOT_STARTED')
    OR (status IN ('FAILED', 'CANCELLED', 'INTERRUPTED')
      AND output_revision_id IS NULL AND finished_at IS NOT NULL AND usage_availability <> 'NOT_STARTED')
    OR (status IN ('BLOCKED', 'NOT_STARTED') AND output_revision_id IS NULL
      AND error_code IS NOT NULL AND finished_at IS NOT NULL AND usage_availability = 'NOT_STARTED')
  )
);

INSERT INTO video_document_generation_runs_visual_input (
  id, document_id, branch_id, operation, status, input_revision_id, output_revision_id,
  provider_key, requested_model, actual_model, reasoning_effort, usage_availability,
  input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
  error_code, error_detail_json, started_at, finished_at
)
SELECT
  id, document_id, branch_id, operation, status, input_revision_id, output_revision_id,
  provider_key, requested_model, actual_model, reasoning_effort, usage_availability,
  input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
  error_code, error_detail_json, started_at, finished_at
FROM video_document_generation_runs;

DROP TABLE video_document_generation_runs;
ALTER TABLE video_document_generation_runs_visual_input RENAME TO video_document_generation_runs;

CREATE INDEX idx_video_document_generation_runs_document
ON video_document_generation_runs(document_id, started_at DESC, id DESC);

CREATE UNIQUE INDEX idx_video_document_generation_runs_active
ON video_document_generation_runs(document_id, operation)
WHERE status = 'RUNNING';
