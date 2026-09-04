CREATE TABLE assistant_runs_reasoning_efforts (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('DRAFT', 'SERIES')),
  scope_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('optimize', 'directions')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED')),
  request_json TEXT NOT NULL,
  context_key TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  capability_receipt_json TEXT NOT NULL,
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  dismissed_at TEXT,
  provider_key TEXT NOT NULL DEFAULT 'codex',
  model_key TEXT NOT NULL DEFAULT 'codex',
  reasoning_effort TEXT CHECK(
    reasoning_effort IS NULL OR reasoning_effort IN ('minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  CHECK(
    (status = 'RUNNING' AND finished_at IS NULL)
    OR (status <> 'RUNNING' AND finished_at IS NOT NULL)
  )
);

INSERT INTO assistant_runs_reasoning_efforts (
  id, scope_kind, scope_id, mode, status, request_json, context_key, context_hash,
  capability_receipt_json, result_json, error_message, created_at, started_at, updated_at,
  finished_at, dismissed_at, provider_key, model_key, reasoning_effort
)
SELECT
  id, scope_kind, scope_id, mode, status, request_json, context_key, context_hash,
  capability_receipt_json, result_json, error_message, created_at, started_at, updated_at,
  finished_at, dismissed_at, provider_key, model_key, reasoning_effort
FROM aiy_assistant_run_migration_source;

DROP VIEW aiy_assistant_run_migration_source;
DROP TABLE assistant_runs;
ALTER TABLE assistant_runs_reasoning_efforts RENAME TO assistant_runs;

CREATE INDEX idx_assistant_runs_scope
ON assistant_runs(scope_kind, scope_id, created_at DESC, id DESC);

CREATE INDEX idx_assistant_runs_status
ON assistant_runs(status, created_at, id);
