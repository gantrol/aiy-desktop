ALTER TABLE prompt_series
ADD COLUMN cover_image_asset_id TEXT REFERENCES image_assets(id) ON DELETE SET NULL;

CREATE TABLE prompt_series_output_exclusions (
  series_id TEXT NOT NULL REFERENCES prompt_series(id),
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  removed_at TEXT NOT NULL CHECK(length(trim(removed_at)) > 0),
  PRIMARY KEY(series_id, image_asset_id)
);

CREATE INDEX idx_prompt_series_output_exclusions_asset
ON prompt_series_output_exclusions(image_asset_id, series_id);
