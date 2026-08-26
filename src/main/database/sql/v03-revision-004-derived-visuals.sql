CREATE TABLE derived_visuals (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('ARTICLE_HEADER', 'ARTICLE_INLINE', 'SOCIAL_POST_COVER')),
  article_id TEXT REFERENCES articles(id),
  article_revision_id TEXT REFERENCES article_revisions(id),
  social_post_id TEXT REFERENCES social_post_drafts(id),
  social_post_revision_id TEXT REFERENCES social_post_revisions(id),
  anchor_json TEXT NOT NULL DEFAULT 'null',
  creation_draft_id TEXT NOT NULL UNIQUE REFERENCES creation_drafts(id),
  prompt_series_id TEXT UNIQUE REFERENCES prompt_series(id),
  selected_image_asset_id TEXT REFERENCES image_assets(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  adopted_at TEXT,
  CHECK(
    (role IN ('ARTICLE_HEADER', 'ARTICLE_INLINE')
      AND article_id IS NOT NULL
      AND article_revision_id IS NOT NULL
      AND social_post_id IS NULL
      AND social_post_revision_id IS NULL)
    OR
    (role = 'SOCIAL_POST_COVER'
      AND article_id IS NULL
      AND article_revision_id IS NULL
      AND social_post_id IS NOT NULL
      AND social_post_revision_id IS NOT NULL)
  )
);

CREATE INDEX idx_derived_visuals_article
ON derived_visuals(article_id, created_at DESC, id DESC)
WHERE article_id IS NOT NULL;

CREATE INDEX idx_derived_visuals_social_post
ON derived_visuals(social_post_id, created_at DESC, id DESC)
WHERE social_post_id IS NOT NULL;

CREATE INDEX idx_derived_visuals_series
ON derived_visuals(prompt_series_id)
WHERE prompt_series_id IS NOT NULL;
