CREATE TABLE prompt_series_cover_assets (
  series_id TEXT NOT NULL REFERENCES prompt_series(id) ON DELETE CASCADE,
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
  PRIMARY KEY(series_id, image_asset_id),
  UNIQUE(series_id, sort_order)
);

CREATE INDEX idx_prompt_series_cover_assets_asset
ON prompt_series_cover_assets(image_asset_id, series_id);

INSERT INTO prompt_series_cover_assets(series_id, image_asset_id, sort_order, created_at)
SELECT id, cover_image_asset_id, 0, created_at
FROM prompt_series
WHERE cover_image_asset_id IS NOT NULL;
