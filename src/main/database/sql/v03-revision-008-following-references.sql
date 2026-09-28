-- A following binding retains its initial immutable reference and its last readable resolution.
CREATE TABLE IF NOT EXISTS content_following_references (
  reference_id TEXT PRIMARY KEY REFERENCES content_block_references(id),
  space_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Delivery preparations persist a mapping to immutable snapshots, including across retries/restarts.
CREATE TABLE IF NOT EXISTS content_reference_resolutions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  bindings_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS content_reference_resolution_bindings ON content_reference_resolutions(space_id,bindings_json);
CREATE TABLE IF NOT EXISTS readable_content_reference_dependencies (
  source_key TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reference_id TEXT NOT NULL REFERENCES content_block_references(id),
  PRIMARY KEY(source_key, reference_id)
);
CREATE INDEX IF NOT EXISTS readable_following_source ON readable_content_reference_dependencies(reference_id,source_key);
