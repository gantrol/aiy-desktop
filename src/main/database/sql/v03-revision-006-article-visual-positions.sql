CREATE TABLE article_visual_positions (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_revision_id TEXT NOT NULL REFERENCES article_revisions(id),
  anchor_json TEXT NOT NULL,
  ever_adopted INTEGER NOT NULL DEFAULT 0 CHECK(ever_adopted IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_article_visual_positions_article ON article_visual_positions(article_id);

ALTER TABLE derived_visuals ADD COLUMN position_id TEXT REFERENCES article_visual_positions(id);
INSERT INTO article_visual_positions (id, article_id, source_revision_id, anchor_json, ever_adopted, created_at)
  SELECT id, article_id, article_revision_id, anchor_json,
    CASE WHEN selected_image_asset_id IS NOT NULL OR adopted_at IS NOT NULL THEN 1 ELSE 0 END, created_at
  FROM derived_visuals WHERE role = 'ARTICLE_INLINE';
UPDATE derived_visuals SET position_id = id WHERE role = 'ARTICLE_INLINE';
CREATE INDEX idx_derived_visuals_position ON derived_visuals(position_id);
