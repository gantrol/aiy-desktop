-- Revision-2 repair fragment for private builds created before transcript
-- translation and its AI Center activity history became part of the release.

CREATE TABLE video_document_translation_runs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  branch_id TEXT NOT NULL REFERENCES document_branches(id),
  input_revision_id TEXT REFERENCES document_draft_revisions(id),
  output_revision_id TEXT REFERENCES document_draft_revisions(id),
  target_locales_json TEXT NOT NULL CHECK(json_valid(target_locales_json) AND json_type(target_locales_json) = 'array'),
  status TEXT NOT NULL CHECK(status IN (
    'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'NOT_STARTED'
  )),
  provider_key TEXT NOT NULL CHECK(provider_key = 'codex'),
  requested_model TEXT NOT NULL CHECK(length(trim(requested_model)) BETWEEN 1 AND 200),
  actual_model TEXT CHECK(actual_model IS NULL OR length(trim(actual_model)) BETWEEN 1 AND 200),
  reasoning_effort TEXT NOT NULL CHECK(reasoning_effort IN ('minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra')),
  completed_batches INTEGER NOT NULL DEFAULT 0 CHECK(completed_batches >= 0),
  total_batches INTEGER CHECK(total_batches IS NULL OR total_batches > 0),
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
  CHECK(total_batches IS NULL OR completed_batches <= total_batches),
  CHECK(
    (status = 'RUNNING' AND output_revision_id IS NULL AND error_code IS NULL AND finished_at IS NULL)
    OR (status = 'SUCCEEDED' AND input_revision_id IS NOT NULL AND output_revision_id IS NOT NULL
      AND error_code IS NULL AND error_detail_json IS NULL AND finished_at IS NOT NULL)
    OR (status IN ('FAILED', 'CANCELLED', 'INTERRUPTED', 'NOT_STARTED')
      AND output_revision_id IS NULL AND error_code IS NOT NULL AND finished_at IS NOT NULL)
  )
);

CREATE INDEX idx_video_document_translation_runs_document
ON video_document_translation_runs(document_id, started_at DESC, id DESC);

CREATE UNIQUE INDEX idx_video_document_translation_runs_active
ON video_document_translation_runs(document_id)
WHERE status = 'RUNNING';
