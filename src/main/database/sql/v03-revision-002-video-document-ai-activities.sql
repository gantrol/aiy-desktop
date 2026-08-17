-- Revision-2 repair fragment for private builds created before local ASR
-- activity history became part of the AI Center.

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
