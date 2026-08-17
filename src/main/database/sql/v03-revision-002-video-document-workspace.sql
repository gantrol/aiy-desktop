-- Revision-2 fragment. Add persisted media probing, durable generation
-- diagnostics, and view-specific mixed navigation ordering.

CREATE TABLE video_assets_revision_6 (
  image_asset_id TEXT PRIMARY KEY REFERENCES image_assets(id),
  duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
  audio_status TEXT NOT NULL DEFAULT 'DETECTION_FAILED'
    CHECK(audio_status IN ('HAS_AUDIO', 'NO_AUDIO', 'DETECTION_FAILED')),
  audio_track_count INTEGER NOT NULL DEFAULT 0 CHECK(audio_track_count >= 0),
  audio_primary_codec TEXT CHECK(
    audio_primary_codec IS NULL OR length(trim(audio_primary_codec)) BETWEEN 1 AND 100
  ),
  audio_detected_at TEXT,
  audio_error_code TEXT CHECK(audio_error_code IS NULL OR length(audio_error_code) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  CHECK(audio_status <> 'HAS_AUDIO' OR audio_track_count > 0),
  CHECK(audio_status <> 'NO_AUDIO' OR audio_track_count = 0),
  CHECK(audio_status = 'DETECTION_FAILED' OR audio_error_code IS NULL)
);

INSERT INTO video_assets_revision_6 (
  image_asset_id, duration_ms, audio_status, audio_track_count,
  audio_primary_codec, audio_detected_at, audio_error_code, created_at
)
SELECT
  image_asset_id, duration_ms, 'DETECTION_FAILED', 0,
  NULL, NULL, 'NOT_PROBED', created_at
FROM video_assets;

DROP TABLE video_assets;
ALTER TABLE video_assets_revision_6 RENAME TO video_assets;

CREATE TABLE video_document_generation_runs_revision_6 (
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

INSERT INTO video_document_generation_runs_revision_6 (
  id, document_id, branch_id, operation, status, input_revision_id, output_revision_id,
  provider_key, requested_model, actual_model, reasoning_effort, usage_availability,
  input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
  error_code, error_detail_json, started_at, finished_at
)
SELECT
  id, document_id, branch_id, operation, status, input_revision_id, output_revision_id,
  provider_key, requested_model, actual_model, reasoning_effort, usage_availability,
  input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
  error_code,
  CASE WHEN error_code IS NULL THEN NULL ELSE json_object(
    'code', error_code,
    'retryable', json('false'),
    'resetAt', NULL,
    'diagnostic', NULL
  ) END,
  started_at, finished_at
FROM video_document_generation_runs;

DROP TABLE video_document_generation_runs;
ALTER TABLE video_document_generation_runs_revision_6 RENAME TO video_document_generation_runs;

CREATE INDEX idx_video_document_generation_runs_document
ON video_document_generation_runs(document_id, started_at DESC, id DESC);

CREATE UNIQUE INDEX idx_video_document_generation_runs_active
ON video_document_generation_runs(document_id, operation)
WHERE status = 'RUNNING';

CREATE TABLE video_document_navigation_order (
  parent_key TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('ALBUM', 'DOCUMENT')),
  target_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(parent_key, target_type, target_id)
);

CREATE INDEX idx_video_document_navigation_order_sort
ON video_document_navigation_order(parent_key, sort_order, target_type, target_id);
