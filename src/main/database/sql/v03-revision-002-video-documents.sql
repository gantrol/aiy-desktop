-- Revision-2 fragment. Preserve the released 0.3.0 tables while widening their
-- closed type sets for video materials and document album placement.

CREATE TABLE materials_revision_5 (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('IMAGE', 'VIDEO', 'TEXT')),
  image_asset_id TEXT REFERENCES image_assets(id),
  text_content TEXT,
  content_hash TEXT NOT NULL,
  source_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK(
    (kind = 'IMAGE' AND image_asset_id IS NOT NULL AND text_content IS NULL) OR
    (kind = 'VIDEO' AND image_asset_id IS NOT NULL AND text_content IS NULL) OR
    (kind = 'TEXT' AND image_asset_id IS NULL AND text_content IS NOT NULL)
  )
);

INSERT INTO materials_revision_5 (
  id, kind, image_asset_id, text_content, content_hash, source_type, created_at, deleted_at
)
SELECT
  id, kind, image_asset_id, text_content, content_hash, source_type, created_at, deleted_at
FROM materials;

DROP TABLE materials;
ALTER TABLE materials_revision_5 RENAME TO materials;

CREATE INDEX idx_materials_active_content
ON materials(kind, content_hash, created_at DESC)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_materials_active_image
ON materials(image_asset_id)
WHERE image_asset_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE album_members_revision_5 (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('MATERIAL', 'SERIES', 'ALBUM', 'DOCUMENT')),
  target_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(album_id, target_type, target_id)
);

INSERT INTO album_members_revision_5 (
  id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at
)
SELECT
  id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at
FROM album_members;

DROP TABLE album_members;
ALTER TABLE album_members_revision_5 RENAME TO album_members;

CREATE UNIQUE INDEX idx_album_members_active_child_owner
ON album_members(target_id)
WHERE target_type = 'ALBUM' AND deleted_at IS NULL;

CREATE INDEX idx_album_members_active_order
ON album_members(album_id, target_type, sort_order, id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_album_members_active_series_owner
ON album_members(target_id)
WHERE target_type = 'SERIES' AND deleted_at IS NULL;

CREATE UNIQUE INDEX idx_album_members_active_document_owner
ON album_members(target_id)
WHERE target_type = 'DOCUMENT' AND deleted_at IS NULL;

CREATE INDEX idx_album_members_reverse
ON album_members(target_type, target_id, album_id)
WHERE deleted_at IS NULL;

CREATE TABLE video_assets (
  image_asset_id TEXT PRIMARY KEY REFERENCES image_assets(id),
  duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL CHECK(origin = 'VIDEO'),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  title_locale TEXT NOT NULL CHECK(title_locale IN ('zh', 'en')),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT
);

CREATE TABLE document_source_relations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  material_id TEXT NOT NULL REFERENCES materials(id),
  role TEXT NOT NULL CHECK(role = 'PRIMARY_VIDEO'),
  created_at TEXT NOT NULL,
  UNIQUE(document_id, role)
);

CREATE TABLE document_branches (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  role TEXT NOT NULL CHECK(role IN (
    'CLEAN_TRANSCRIPT', 'ARTICLE', 'NOTES', 'STORY_NO_SPOILER', 'STORY_SPOILER'
  )),
  spoiler_level TEXT NOT NULL CHECK(spoiler_level IN ('NONE', 'FULL')),
  status TEXT NOT NULL CHECK(status IN (
    'EMPTY', 'PROCESSING', 'PARTIAL', 'EDITABLE', 'CONFIRMED', 'FAILED'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(document_id, role)
);

CREATE TABLE document_drafts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL UNIQUE REFERENCES document_branches(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE document_draft_revisions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES document_drafts(id),
  parent_revision_id TEXT REFERENCES document_draft_revisions(id),
  revision_no INTEGER NOT NULL CHECK(revision_no > 0),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_hash TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('SYSTEM', 'AGENT', 'HUMAN')),
  created_at TEXT NOT NULL,
  UNIQUE(draft_id, revision_no)
);

CREATE INDEX idx_document_branches_active
ON document_branches(document_id, role, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_document_draft_revisions_latest
ON document_draft_revisions(draft_id, revision_no DESC);

CREATE INDEX idx_document_sources_material
ON document_source_relations(material_id, document_id);

CREATE INDEX idx_documents_active_updated
ON documents(updated_at DESC, id)
WHERE deleted_at IS NULL;

CREATE TABLE document_thumbnails (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE video_document_generation_runs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  branch_id TEXT NOT NULL REFERENCES document_branches(id),
  operation TEXT NOT NULL CHECK(operation = 'ARTICLE_GENERATE'),
  status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  input_revision_id TEXT NOT NULL REFERENCES document_draft_revisions(id),
  output_revision_id TEXT REFERENCES document_draft_revisions(id),
  provider_key TEXT NOT NULL CHECK(provider_key = 'codex'),
  requested_model TEXT NOT NULL CHECK(length(trim(requested_model)) BETWEEN 1 AND 200),
  actual_model TEXT CHECK(actual_model IS NULL OR length(trim(actual_model)) BETWEEN 1 AND 200),
  reasoning_effort TEXT NOT NULL CHECK(reasoning_effort = 'max'),
  usage_availability TEXT NOT NULL CHECK(usage_availability IN ('PROVIDED', 'MISSING')),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens INTEGER CHECK(cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  reasoning_output_tokens INTEGER CHECK(reasoning_output_tokens IS NULL OR reasoning_output_tokens >= 0),
  total_tokens INTEGER CHECK(total_tokens IS NULL OR total_tokens >= 0),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  CHECK(
    (status = 'RUNNING' AND output_revision_id IS NULL AND finished_at IS NULL)
    OR (status = 'SUCCEEDED' AND output_revision_id IS NOT NULL AND error_code IS NULL AND finished_at IS NOT NULL)
    OR (status IN ('FAILED', 'CANCELLED', 'INTERRUPTED') AND output_revision_id IS NULL AND finished_at IS NOT NULL)
  )
);

CREATE INDEX idx_video_document_generation_runs_document
ON video_document_generation_runs(document_id, started_at DESC, id DESC);

CREATE UNIQUE INDEX idx_video_document_generation_runs_active
ON video_document_generation_runs(document_id, operation)
WHERE status = 'RUNNING';

CREATE TABLE video_document_transcription_runs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  output_revision_id TEXT REFERENCES document_draft_revisions(id),
  status TEXT NOT NULL CHECK(status IN (
    'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'NOT_STARTED'
  )),
  provider_key TEXT NOT NULL CHECK(provider_key = 'qwen-local'),
  model_id TEXT NOT NULL CHECK(model_id = 'Qwen/Qwen3-ASR-0.6B'),
  completed_chunks INTEGER NOT NULL DEFAULT 0 CHECK(completed_chunks >= 0),
  total_chunks INTEGER CHECK(total_chunks IS NULL OR total_chunks > 0),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  retryable INTEGER CHECK(retryable IS NULL OR retryable IN (0, 1)),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  CHECK(total_chunks IS NULL OR completed_chunks <= total_chunks),
  CHECK(
    (status = 'RUNNING' AND output_revision_id IS NULL AND error_code IS NULL
      AND retryable IS NULL AND finished_at IS NULL)
    OR (status = 'SUCCEEDED' AND output_revision_id IS NOT NULL AND error_code IS NULL
      AND retryable IS NULL AND finished_at IS NOT NULL)
    OR (status IN ('FAILED', 'CANCELLED', 'INTERRUPTED', 'NOT_STARTED')
      AND output_revision_id IS NULL AND error_code IS NOT NULL
      AND retryable IS NOT NULL AND finished_at IS NOT NULL)
  )
);

CREATE INDEX idx_video_document_transcription_runs_document
ON video_document_transcription_runs(document_id, started_at DESC, id DESC);

CREATE UNIQUE INDEX idx_video_document_transcription_runs_active
ON video_document_transcription_runs(document_id)
WHERE status = 'RUNNING';

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
