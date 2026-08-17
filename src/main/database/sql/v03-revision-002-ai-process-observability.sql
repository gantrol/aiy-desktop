-- Common forward-only revision-2 additions for every supported revision-1
-- database shape. Title localization is normalized separately when the source
-- is the immutable legacy release schema.

-- creator_agent_turns shipped without JSON CHECK constraints. SQLite cannot add
-- those constraints in place, and rebuilding the table would rewrite user data.
-- These triggers therefore validate all future writes while existing rows remain
-- untouched and are validated by the application when read.
CREATE TRIGGER creator_agent_turns_json_before_insert
BEFORE INSERT ON creator_agent_turns
WHEN CASE
  -- SQLite CASE is lazy: reject by bytes before invoking the JSON parser.
  WHEN length(CAST(NEW.request_json AS BLOB)) > 8388608 THEN 1
  WHEN NOT json_valid(NEW.request_json) THEN 1
  WHEN length(CAST(NEW.result_json AS BLOB)) > 8388608 THEN 1
  WHEN NOT json_valid(NEW.result_json) THEN 1
  ELSE 0
END
BEGIN
  SELECT RAISE(ABORT, 'Creator agent turn JSON is invalid or exceeds 8 MiB');
END;

CREATE TRIGGER creator_agent_turns_json_before_update
BEFORE UPDATE OF request_json, result_json ON creator_agent_turns
WHEN CASE
  -- SQLite CASE is lazy: reject by bytes before invoking the JSON parser.
  WHEN length(CAST(NEW.request_json AS BLOB)) > 8388608 THEN 1
  WHEN NOT json_valid(NEW.request_json) THEN 1
  WHEN length(CAST(NEW.result_json AS BLOB)) > 8388608 THEN 1
  WHEN NOT json_valid(NEW.result_json) THEN 1
  ELSE 0
END
BEGIN
  SELECT RAISE(ABORT, 'Creator agent turn JSON is invalid or exceeds 8 MiB');
END;

-- Bounded, application-observable execution history. These tables deliberately
-- store normalized headers and external identifiers, never raw provider RPC
-- payloads, credentials, hidden reasoning, or generated media bytes.
CREATE TABLE ai_processes (
  id TEXT PRIMARY KEY,
  process_kind TEXT NOT NULL CHECK(process_kind IN ('AGENT_CHAT')),
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('DRAFT', 'SERIES')),
  scope_id TEXT NOT NULL CHECK(length(trim(scope_id)) > 0),
  status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  completeness TEXT NOT NULL CHECK(completeness IN ('COMPLETE', 'COMPLETE_WITH_REDACTION', 'PARTIAL_PROVIDER', 'PARTIAL_CAPTURE', 'TRUNCATED_BY_POLICY', 'EXTERNAL_REFERENCE_ONLY')),
  creator_agent_turn_id TEXT UNIQUE REFERENCES creator_agent_turns(id),
  last_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_event_sequence >= 0),
  dropped_event_count INTEGER NOT NULL DEFAULT 0 CHECK(dropped_event_count >= 0),
  dropped_event_count_exact INTEGER NOT NULL DEFAULT 1 CHECK(dropped_event_count_exact IN (0, 1)),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) <= 100),
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE ai_process_attempts (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES ai_processes(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL CHECK(attempt_no > 0),
  provider_key TEXT NOT NULL CHECK(length(provider_key) BETWEEN 1 AND 100),
  transport TEXT NOT NULL CHECK(transport IN ('PENDING', 'APP_SERVER', 'CLI')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  completeness TEXT NOT NULL CHECK(completeness IN ('COMPLETE', 'COMPLETE_WITH_REDACTION', 'PARTIAL_PROVIDER', 'PARTIAL_CAPTURE', 'TRUNCATED_BY_POLICY', 'EXTERNAL_REFERENCE_ONLY')),
  dropped_event_count INTEGER NOT NULL DEFAULT 0 CHECK(dropped_event_count >= 0),
  dropped_event_count_exact INTEGER NOT NULL DEFAULT 1 CHECK(dropped_event_count_exact IN (0, 1)),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(process_id, attempt_no)
);

CREATE TABLE ai_process_events (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES ai_processes(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES ai_process_attempts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  event_kind TEXT NOT NULL CHECK(length(event_kind) BETWEEN 1 AND 100),
  rpc_method TEXT CHECK(rpc_method IS NULL OR length(rpc_method) <= 200),
  item_id TEXT CHECK(item_id IS NULL OR length(item_id) <= 512),
  item_type TEXT CHECK(item_type IS NULL OR length(item_type) <= 100),
  item_status TEXT CHECK(item_status IS NULL OR length(item_status) <= 100),
  tool_kind TEXT CHECK(tool_kind IS NULL OR length(tool_kind) <= 100),
  tool_name TEXT CHECK(tool_name IS NULL OR length(tool_name) <= 200),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens INTEGER CHECK(cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  reasoning_output_tokens INTEGER CHECK(reasoning_output_tokens IS NULL OR reasoning_output_tokens >= 0),
  total_tokens INTEGER CHECK(total_tokens IS NULL OR total_tokens >= 0),
  degradation_reason TEXT CHECK(degradation_reason IS NULL OR length(degradation_reason) <= 100),
  dropped_event_count INTEGER CHECK(dropped_event_count IS NULL OR dropped_event_count >= 0),
  observed_at TEXT NOT NULL,
  UNIQUE(process_id, sequence)
);

CREATE TABLE ai_process_external_refs (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES ai_processes(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES ai_process_attempts(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL CHECK(length(provider_key) BETWEEN 1 AND 100),
  ref_kind TEXT NOT NULL CHECK(ref_kind IN ('THREAD_ID', 'TURN_ID')),
  ref_value TEXT NOT NULL CHECK(length(ref_value) BETWEEN 1 AND 512),
  created_at TEXT NOT NULL,
  UNIQUE(process_id, provider_key, ref_kind, ref_value)
);

CREATE TABLE ai_process_context_turns (
  process_id TEXT NOT NULL REFERENCES ai_processes(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  creator_agent_turn_id TEXT NOT NULL REFERENCES creator_agent_turns(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(process_id, ordinal),
  UNIQUE(process_id, creator_agent_turn_id)
);

CREATE INDEX idx_ai_processes_scope
ON ai_processes(scope_kind, scope_id, started_at DESC, id DESC);

CREATE INDEX idx_ai_processes_running
ON ai_processes(status, started_at, id);

CREATE INDEX idx_ai_process_attempts_process
ON ai_process_attempts(process_id, attempt_no);

CREATE INDEX idx_ai_process_events_process
ON ai_process_events(process_id, sequence);

CREATE INDEX idx_ai_process_external_refs_process
ON ai_process_external_refs(process_id, ref_kind, created_at, id);

CREATE INDEX idx_ai_process_context_turns_turn
ON ai_process_context_turns(creator_agent_turn_id, process_id);

CREATE TRIGGER ai_process_events_no_delete
BEFORE DELETE ON ai_process_events
BEGIN
  SELECT RAISE(ABORT, 'AI process events are immutable');
END;

CREATE TRIGGER ai_process_events_no_update
BEFORE UPDATE ON ai_process_events
BEGIN
  SELECT RAISE(ABORT, 'AI process events are immutable');
END;

CREATE TRIGGER ai_process_context_turns_no_delete
BEFORE DELETE ON ai_process_context_turns
BEGIN
  SELECT RAISE(ABORT, 'AI process context links are immutable');
END;

CREATE TRIGGER ai_process_context_turns_no_update
BEFORE UPDATE ON ai_process_context_turns
BEGIN
  SELECT RAISE(ABORT, 'AI process context links are immutable');
END;

CREATE TRIGGER ai_process_external_refs_no_delete
BEFORE DELETE ON ai_process_external_refs
BEGIN
  SELECT RAISE(ABORT, 'AI process external references are immutable');
END;

CREATE TRIGGER ai_process_external_refs_no_update
BEFORE UPDATE ON ai_process_external_refs
BEGIN
  SELECT RAISE(ABORT, 'AI process external references are immutable');
END;
