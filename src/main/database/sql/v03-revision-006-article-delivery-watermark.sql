ALTER TABLE article_delivery_jobs ADD COLUMN watermark_profile_json TEXT
  CHECK(watermark_profile_json IS NULL OR json_valid(watermark_profile_json));
