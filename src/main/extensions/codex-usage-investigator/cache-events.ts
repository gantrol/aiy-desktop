import type Database from 'better-sqlite3';
import { storedEventRowSchema, type StoredEventRow } from '@/main/extensions/codex-usage-investigator/cache-records';
import { sqlitePages } from '@/main/extensions/codex-usage-investigator/sqlite-pages';

/** One source query serves investigator aggregates and exact metric record references. */
export function* cachedUsageEventPages(
  database: Database.Database,
  fromEpoch: number | null,
  toEpoch: number,
): Iterable<ReadonlyArray<StoredEventRow>> {
  const statement = database.prepare(
    `SELECT
       current.source_session_id AS sessionId,
       current.event_order AS eventOrder,
       current.event_fingerprint AS eventFingerprint,
       current.turn_id AS turnId,
       current.timestamp_ms AS timestampMs,
       current.timestamp,
       current.model,
       current.service_tier AS serviceTier,
       current.service_tier_inferred AS serviceTierInferred,
       current.quota_kind AS quotaKind,
       current.limit_id AS limitId,
       current.plan_type AS planType,
       current.used_percent AS usedPercent,
       current.window_duration_mins AS windowDurationMins,
       current.resets_at AS resetsAt,
       current.secondary_used_percent AS secondaryUsedPercent,
       current.secondary_window_duration_mins AS secondaryWindowDurationMins,
       current.secondary_resets_at AS secondaryResetsAt,
       current.input_tokens AS inputTokens,
       current.cached_input_tokens AS cachedInputTokens,
       current.cache_write_input_tokens AS cacheWriteInputTokens,
       current.output_tokens AS outputTokens,
       current.reasoning_output_tokens AS reasoningOutputTokens,
       current.total_tokens AS totalTokens
     FROM usage_events AS current
     WHERE current.timestamp_ms >= COALESCE(?, 0) AND current.timestamp_ms <= ?
       AND (
         current.total_tokens = 0
         OR NOT EXISTS (
           SELECT 1 FROM usage_events AS previous
           WHERE previous.event_fingerprint = current.event_fingerprint
             AND previous.total_tokens > 0
             AND previous.source_session_id <> current.source_session_id
             AND (
               previous.service_tier_inferred < current.service_tier_inferred
               OR (
                 previous.service_tier_inferred = current.service_tier_inferred
                 AND (previous.timestamp_ms, previous.source_session_id)
                   < (current.timestamp_ms, current.source_session_id)
               )
             )
         )
       )
     ORDER BY current.timestamp_ms ASC, current.source_session_id ASC, current.event_order ASC`,
  );
  yield* sqlitePages(statement.iterate(fromEpoch, toEpoch), storedEventRowSchema);
}
