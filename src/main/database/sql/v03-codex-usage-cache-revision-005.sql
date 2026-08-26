ALTER TABLE usage_events
  ADD COLUMN service_tier_inferred INTEGER NOT NULL DEFAULT 0
  CHECK (service_tier_inferred IN (0, 1));

DROP INDEX IF EXISTS usage_events_fingerprint_order_idx;
CREATE INDEX usage_events_fingerprint_order_idx
  ON usage_events (
    event_fingerprint,
    service_tier_inferred,
    timestamp_ms,
    source_session_id,
    event_order
  );

DELETE FROM usage_processed_cache;
