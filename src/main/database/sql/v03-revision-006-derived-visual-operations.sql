CREATE TABLE derived_visual_operations (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  visual_id TEXT NOT NULL REFERENCES derived_visuals(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('ADOPT', 'UNDO')),
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'SUCCEEDED', 'CONFLICT', 'CANCELLED')),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('ARTICLE', 'SOCIAL_POST')),
  target_id TEXT NOT NULL,
  before_revision_id TEXT NOT NULL,
  result_revision_id TEXT,
  observed_revision_id TEXT,
  conflict_reason TEXT CHECK(conflict_reason IN ('TARGET_CHANGED', 'VISUAL_CHANGED', 'ALREADY_UNDONE')),
  before_visual_json TEXT,
  after_visual_json TEXT,
  undone_by_request_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_derived_visual_operations_visual ON derived_visual_operations(visual_id, sequence DESC);
CREATE INDEX idx_derived_visual_operations_target ON derived_visual_operations(target_kind, target_id, sequence DESC);
CREATE UNIQUE INDEX idx_derived_visual_operations_pending ON derived_visual_operations(visual_id) WHERE status = 'PENDING';
