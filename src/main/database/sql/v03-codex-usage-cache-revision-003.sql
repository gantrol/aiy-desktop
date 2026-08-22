ALTER TABLE usage_events ADD COLUMN secondary_used_percent REAL;
ALTER TABLE usage_events ADD COLUMN secondary_window_duration_mins REAL;
ALTER TABLE usage_events ADD COLUMN secondary_resets_at INTEGER;

DELETE FROM usage_processed_cache;
