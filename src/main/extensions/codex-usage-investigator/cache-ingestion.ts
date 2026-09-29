import type Database from 'better-sqlite3';
import {
  codexUsageSessionReadResultSchema,
  type SessionReadResult,
} from '@/main/extensions/codex-usage-investigator/session-reader';
import type { CodexUsageFileFingerprint } from '@/main/extensions/codex-usage-investigator/cache-records';
import { codexUsageSourceCacheKey } from '@/main/extensions/codex-usage-investigator/source-cache-key';
import type { CodexUsageServiceTierFallback } from '@/main/extensions/codex-usage-investigator/service-tier-fallback';
import {
  readSourceRetention,
  prepareSourceReplacement,
} from '@/main/extensions/codex-usage-investigator/source-retention';

export function replaceCodexUsageSource(
  database: Database.Database,
  file: CodexUsageFileFingerprint,
  result: SessionReadResult,
  serviceTierFallback?: CodexUsageServiceTierFallback | null,
) {
  const parsed = codexUsageSessionReadResultSchema.parse(result);
  const events = [...parsed.events].sort(
    (left, right) =>
      Date.parse(left.timestamp) - Date.parse(right.timestamp) || (left.turnId ?? '').localeCompare(right.turnId ?? ''),
  );
  const chatTurns = [...parsed.chatTurns].sort((left, right) => left.turnOrder - right.turnOrder);
  const cacheKey = codexUsageSourceCacheKey(file, serviceTierFallback);
  const firstEventMs = events.length ? Date.parse(events[0]!.timestamp) : null;
  const lastEventMs = events.length ? Date.parse(events.at(-1)!.timestamp) : null;
  const updatedAt = new Date().toISOString();
  const upsertSource = database.prepare(
    `INSERT INTO usage_source_files (
      session_id, cache_key, size_bytes, mtime_ns, ctime_ns, thread_source, thread_created_ms,
      first_event_ms, last_event_ms, event_count, invalid_records, oversized_records,
      bytes_read, context_compaction_count, turn_metadata_complete, updated_at, history_retained
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      cache_key = excluded.cache_key,
      size_bytes = excluded.size_bytes,
      mtime_ns = excluded.mtime_ns,
      ctime_ns = excluded.ctime_ns,
      thread_source = excluded.thread_source,
      thread_created_ms = excluded.thread_created_ms,
      first_event_ms = excluded.first_event_ms,
      last_event_ms = excluded.last_event_ms,
      event_count = excluded.event_count,
      invalid_records = excluded.invalid_records,
      oversized_records = excluded.oversized_records,
      bytes_read = excluded.bytes_read,
      context_compaction_count = excluded.context_compaction_count,
      turn_metadata_complete = excluded.turn_metadata_complete,
      updated_at = excluded.updated_at,
      history_retained = excluded.history_retained`,
  );
  const insertEvent = database.prepare(
    `INSERT INTO usage_events (
      source_session_id, event_order, event_fingerprint, turn_id, timestamp_ms, timestamp, model,
      service_tier, service_tier_inferred, quota_kind,
      limit_id, plan_type, used_percent, window_duration_mins, resets_at,
      secondary_used_percent, secondary_window_duration_mins, secondary_resets_at,
      input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens,
      reasoning_output_tokens, total_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertChatTurn = database.prepare(
    `INSERT INTO usage_chat_turns (
      source_session_id, turn_order, turn_id, started_ms, started_at,
      terminal_ms, terminal_at, terminal_state, duration_ms, model, reasoning_effort, service_tier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_session_id, turn_id) DO UPDATE SET
      started_ms = MIN(usage_chat_turns.started_ms, excluded.started_ms),
      started_at = MIN(usage_chat_turns.started_at, excluded.started_at),
      terminal_ms = COALESCE(excluded.terminal_ms, usage_chat_turns.terminal_ms),
      terminal_at = COALESCE(excluded.terminal_at, usage_chat_turns.terminal_at),
      terminal_state = COALESCE(excluded.terminal_state, usage_chat_turns.terminal_state),
      duration_ms = COALESCE(excluded.duration_ms, usage_chat_turns.duration_ms),
      model = COALESCE(excluded.model, usage_chat_turns.model),
      reasoning_effort = COALESCE(excluded.reasoning_effort, usage_chat_turns.reasoning_effort),
      service_tier = CASE WHEN excluded.service_tier = 'UNKNOWN'
        THEN usage_chat_turns.service_tier ELSE excluded.service_tier END`,
  );
  database.transaction(() => {
    const retained = readSourceRetention(database, file, parsed);
    upsertSource.run(
      file.sessionId,
      cacheKey,
      file.size,
      file.mtimeNs,
      file.ctimeNs,
      file.threadSource,
      file.createdAtMs,
      firstEventMs,
      lastEventMs,
      events.length,
      parsed.invalidRecords,
      parsed.oversizedRecords,
      parsed.bytesRead,
      Math.max(parsed.contextCompactionCount, retained.contextCompactionCount),
      parsed.turnMetadataComplete && retained.turnMetadataComplete ? 1 : 0,
      updatedAt,
      retained.keepHistory ? 1 : 0,
    );
    const { eventOffset, turnOffset } = prepareSourceReplacement(
      database,
      file.sessionId,
      events,
      retained.keepHistory,
    );
    chatTurns.forEach((turn) => {
      insertChatTurn.run(
        file.sessionId,
        turnOffset + turn.turnOrder,
        turn.turnId,
        Date.parse(turn.startedAt),
        turn.startedAt,
        turn.terminalAt ? Date.parse(turn.terminalAt) : null,
        turn.terminalAt,
        turn.terminalState,
        turn.durationMs,
        turn.model,
        turn.reasoningEffort,
        turn.serviceTier,
      );
    });
    events.forEach((event, eventOrder) => {
      insertEvent.run(
        file.sessionId,
        eventOffset + eventOrder,
        event.eventFingerprint,
        event.turnId,
        Date.parse(event.timestamp),
        event.timestamp,
        event.model,
        event.serviceTier,
        event.serviceTierInferred ? 1 : 0,
        event.quotaKind,
        event.limitId,
        event.planType,
        event.usedPercent,
        event.windowDurationMins,
        event.resetsAt,
        event.secondaryUsedPercent,
        event.secondaryWindowDurationMins,
        event.secondaryResetsAt,
        event.usage.inputTokens,
        event.usage.cachedInputTokens,
        event.usage.cacheWriteInputTokens,
        event.usage.outputTokens,
        event.usage.reasoningOutputTokens,
        event.usage.totalTokens,
      );
    });
    database
      .prepare(
        `UPDATE usage_source_files SET
      first_event_ms = (SELECT MIN(timestamp_ms) FROM usage_events WHERE source_session_id = @sessionId),
      last_event_ms = (SELECT MAX(timestamp_ms) FROM usage_events WHERE source_session_id = @sessionId),
      event_count = (SELECT COUNT(*) FROM usage_events WHERE source_session_id = @sessionId)
      WHERE session_id = @sessionId`,
      )
      .run({ sessionId: file.sessionId });
    database.prepare('UPDATE usage_ingestion_meta SET data_revision = data_revision + 1 WHERE id = 1').run();
    database.prepare('DELETE FROM usage_processed_cache').run();
  })();
}
