CREATE TABLE IF NOT EXISTS gif_documents (
  id TEXT PRIMARY KEY,
  series_id TEXT REFERENCES prompt_series(id),
  title TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'GIF' CHECK(purpose IN ('GIF','MOTION')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gif_documents_series ON gif_documents(series_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS gif_document_revisions (
  document_id TEXT NOT NULL REFERENCES gif_documents(id),
  revision INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  motion_draft_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(document_id, revision)
);
CREATE TABLE IF NOT EXISTS gif_document_assets (
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  asset_id TEXT NOT NULL REFERENCES image_assets(id),
  PRIMARY KEY(document_id, revision, asset_id),
  FOREIGN KEY(document_id, revision) REFERENCES gif_document_revisions(document_id, revision)
);
CREATE INDEX IF NOT EXISTS gif_document_assets_asset ON gif_document_assets(asset_id);
CREATE TABLE IF NOT EXISTS gif_export_runs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  output_asset_id TEXT REFERENCES image_assets(id),
  encoder TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id, revision) REFERENCES gif_document_revisions(document_id, revision)
);
CREATE INDEX IF NOT EXISTS gif_export_runs_output ON gif_export_runs(output_asset_id);
CREATE TABLE IF NOT EXISTS gif_generation_runs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  settings_json TEXT NOT NULL,
  audit_json TEXT,
  state TEXT NOT NULL CHECK(state IN ('PREPARING','GENERATING','COMPOSITING','READY','ADOPTED','FAILED','CANCELLED')),
  generation_run_id TEXT REFERENCES generation_runs(id),
  manifest_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id,revision) REFERENCES gif_document_revisions(document_id,revision)
);
CREATE INDEX IF NOT EXISTS gif_generation_document ON gif_generation_runs(document_id,created_at DESC);
CREATE TABLE IF NOT EXISTS gif_generation_assets (
  run_id TEXT NOT NULL REFERENCES gif_generation_runs(id),
  asset_id TEXT NOT NULL REFERENCES image_assets(id),
  PRIMARY KEY(run_id,asset_id)
);
CREATE INDEX IF NOT EXISTS gif_generation_asset ON gif_generation_assets(asset_id);
CREATE TABLE IF NOT EXISTS gif_workspace_state (
  document_id TEXT PRIMARY KEY REFERENCES gif_documents(id),
  state_json TEXT NOT NULL CHECK(json_valid(state_json))
);
CREATE TABLE IF NOT EXISTS gif_execution_series (
  document_id TEXT PRIMARY KEY REFERENCES gif_documents(id),
  series_id TEXT NOT NULL UNIQUE REFERENCES prompt_series(id)
);
CREATE TABLE IF NOT EXISTS gif_frame_groups (
  document_id TEXT NOT NULL REFERENCES gif_documents(id),
  candidate_id TEXT NOT NULL REFERENCES gif_generation_runs(id),
  post_id TEXT NOT NULL REFERENCES social_post_drafts(id),
  PRIMARY KEY(document_id,candidate_id)
);
