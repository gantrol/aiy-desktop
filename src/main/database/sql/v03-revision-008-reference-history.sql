-- A saved consumer revision keeps the dependency resolution observed when it was saved.
-- Unavailable references must not prevent preserving the user's other edits.
CREATE TABLE IF NOT EXISTS article_reference_history (
  revision_id TEXT PRIMARY KEY REFERENCES article_revisions(id) ON DELETE CASCADE,
  resolution_id TEXT REFERENCES content_reference_resolutions(id),
  state TEXT NOT NULL CHECK(state IN ('COMPLETE', 'UNAVAILABLE')),
  CHECK((state = 'COMPLETE' AND resolution_id IS NOT NULL) OR (state = 'UNAVAILABLE' AND resolution_id IS NULL))
);