ALTER TABLE usage_source_files
  ADD COLUMN history_retained INTEGER NOT NULL DEFAULT 0
  CHECK (history_retained IN (0, 1));

DELETE FROM usage_processed_cache;
