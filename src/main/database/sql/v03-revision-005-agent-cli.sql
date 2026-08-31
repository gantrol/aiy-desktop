CREATE TABLE agent_command_requests (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  command TEXT NOT NULL CHECK(command IN ('ASSET_IMPORT', 'DRAFT_PREPARE', 'GENERATION_START', 'JOB_CANCEL')),
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 64),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0)
);

CREATE TABLE agent_generation_jobs (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
  started_at TEXT
);

CREATE TABLE agent_generation_job_runs (
  job_id TEXT NOT NULL REFERENCES agent_generation_jobs(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE REFERENCES generation_runs(id),
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  PRIMARY KEY(job_id, run_id),
  UNIQUE(job_id, sort_order)
);

CREATE INDEX idx_agent_generation_job_runs_order
ON agent_generation_job_runs(job_id, sort_order);
