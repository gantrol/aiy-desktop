-- Fixed excerpts survive source deletion and revision packing. They are never editable authorities.
CREATE TABLE IF NOT EXISTS content_block_references (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS content_block_reference_source ON content_block_references(source_kind, source_id, revision_id);
CREATE TABLE IF NOT EXISTS content_block_assets (
  reference_id TEXT NOT NULL REFERENCES content_block_references(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES image_assets(id),
  PRIMARY KEY(reference_id, asset_id)
);
CREATE TABLE IF NOT EXISTS content_editor_drafts (
  source_id TEXT NOT NULL REFERENCES inspiration_stashes(id) ON DELETE CASCADE,
  editor_id TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_id, editor_id)
);
CREATE TABLE IF NOT EXISTS readable_content_files (
  source_key TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  album_id TEXT,
  relative_directory TEXT NOT NULL UNIQUE,
  revision_id TEXT NOT NULL,
  files_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS readable_content_album ON readable_content_files(album_id, state);
CREATE TABLE IF NOT EXISTS readable_content_assets (
  source_key TEXT NOT NULL REFERENCES readable_content_files(source_key) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  PRIMARY KEY(source_key, asset_id)
);
CREATE INDEX IF NOT EXISTS readable_content_asset_lookup ON readable_content_assets(asset_id);
CREATE TABLE IF NOT EXISTS readable_content_jobs (
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(source_kind, source_id)
);
