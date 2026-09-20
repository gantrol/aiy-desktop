ALTER TABLE article_delivery_jobs ADD COLUMN image_preparation_json TEXT
  CHECK(image_preparation_json IS NULL OR json_valid(image_preparation_json));
