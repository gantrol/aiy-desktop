ALTER TABLE usage_events ADD COLUMN event_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS usage_events_fingerprint_order_idx
  ON usage_events (event_fingerprint, timestamp_ms, source_session_id, event_order);

DELETE FROM usage_processed_cache;
DELETE FROM session_analysis_cache;
DELETE FROM scan_tasks;
DELETE FROM usage_events;
DELETE FROM usage_source_files;

UPDATE usage_ingestion_meta
SET data_revision = data_revision + 1
WHERE id = 1;
