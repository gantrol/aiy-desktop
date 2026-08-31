-- Revision-6 context-compaction fragment. Kept separate so private revision-6
-- caches can complete the consolidated public shape without replaying tables.
ALTER TABLE usage_source_files
ADD COLUMN context_compaction_count INTEGER NOT NULL DEFAULT 0
CHECK (context_compaction_count >= 0);

DELETE FROM usage_processed_cache;
DELETE FROM session_analysis_cache;

UPDATE usage_ingestion_meta
SET data_revision = data_revision + 1
WHERE id = 1;
