-- Revision-2 fragment for managed term illustration candidates.
CREATE TABLE term_illustration_batches (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL REFERENCES terms(id),
  term_revision_id TEXT NOT NULL REFERENCES term_revisions(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('COVER', 'RELATED')),
  profile_id TEXT NOT NULL,
  profile_revision INTEGER NOT NULL CHECK(profile_revision >= 1),
  prompt_profile_id TEXT NOT NULL,
  expression_revision_id TEXT NOT NULL REFERENCES term_expressions(id),
  model_key TEXT NOT NULL,
  quality TEXT NOT NULL CHECK(quality IN ('low', 'medium', 'high')),
  series_id TEXT REFERENCES prompt_series(id),
  prompt_version_id TEXT REFERENCES prompt_versions(id),
  status TEXT NOT NULL CHECK(status IN ('PREPARING', 'SUBMITTED', 'FAILED')),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE term_illustration_batch_runs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES term_illustration_batches(id) ON DELETE CASCADE,
  generation_run_id TEXT NOT NULL UNIQUE REFERENCES generation_runs(id),
  decision TEXT NOT NULL CHECK(decision IN ('PENDING', 'ADOPTED_COVER', 'ADOPTED_RELATED', 'DISMISSED')),
  term_media_link_id TEXT REFERENCES term_media_links(id),
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_term_illustration_batches_term
  ON term_illustration_batches(term_id, created_at DESC, id DESC);

CREATE INDEX idx_term_illustration_batch_runs_batch
  ON term_illustration_batch_runs(batch_id, created_at, id);
