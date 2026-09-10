import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  CODEX_USAGE_EVENT_PAGE_SIZE,
  eventFromStoredRow,
  storedChatTurnRowSchema,
  storedEventRowSchema,
  storedSessionSourceRowSchema,
  type CodexUsageSessionSourceRecord,
  type CodexUsageStoredChatTurn,
} from '@/main/extensions/codex-usage-investigator/cache-records';
import type { CodexUsageInternalEvent } from '@/main/extensions/codex-usage-investigator/session-reader';
import { sqlitePages } from '@/main/extensions/codex-usage-investigator/sqlite-pages';

const processingWorkloadRowSchema = z
  .object({
    sessionSourceCount: z.number().int().nonnegative().safe(),
    chatTurnCount: z.number().int().nonnegative().safe(),
  })
  .strict();

export function processingWorkload(database: Database.Database) {
  return processingWorkloadRowSchema.parse(
    database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM usage_source_files) AS sessionSourceCount,
          (SELECT COUNT(*) FROM usage_chat_turns) AS chatTurnCount`,
      )
      .get(),
  );
}

export function* sessionSourcePages(
  database: Database.Database,
): Iterable<ReadonlyArray<CodexUsageSessionSourceRecord>> {
  const statement = database.prepare(
    `SELECT
      source.session_id AS sessionId,
      source.thread_source AS threadSource,
      source.invalid_records AS invalidRecords,
      source.oversized_records AS oversizedRecords,
      source.context_compaction_count AS contextCompactionCount,
      source.turn_metadata_complete AS turnMetadataComplete,
      EXISTS (
        SELECT 1
        FROM usage_events AS event
        LEFT JOIN usage_chat_turns AS chat_turn
          ON chat_turn.source_session_id = event.source_session_id
         AND chat_turn.turn_id = event.turn_id
        WHERE event.source_session_id = source.session_id
          AND event.total_tokens > 0
          AND (event.turn_id IS NULL OR chat_turn.turn_id IS NULL)
      ) AS hasUnassignedUsage
     FROM usage_source_files AS source
     WHERE source.session_id > ?
     ORDER BY source.session_id ASC
     LIMIT ?`,
  );
  let cursor = '';
  while (true) {
    const rows = z
      .array(storedSessionSourceRowSchema)
      .max(CODEX_USAGE_EVENT_PAGE_SIZE)
      .parse(statement.all(cursor, CODEX_USAGE_EVENT_PAGE_SIZE));
    if (!rows.length) return;
    yield rows.map((row) => ({
      sessionId: row.sessionId,
      threadSource: row.threadSource,
      invalidRecords: row.invalidRecords,
      oversizedRecords: row.oversizedRecords,
      contextCompactionCount: row.contextCompactionCount,
      turnMetadataComplete: row.turnMetadataComplete === 1,
      hasUnassignedUsage: row.hasUnassignedUsage === 1,
    }));
    const last = rows.at(-1);
    if (!last || rows.length < CODEX_USAGE_EVENT_PAGE_SIZE) return;
    cursor = last.sessionId;
  }
}

export function* chatTurnPages(database: Database.Database): Iterable<ReadonlyArray<CodexUsageStoredChatTurn>> {
  const statement = database.prepare(
    `SELECT
      chat_turn.source_session_id AS sessionId,
      chat_turn.turn_order AS turnOrder,
      chat_turn.turn_id AS turnId,
      chat_turn.started_ms AS startedMs,
      chat_turn.started_at AS startedAt,
      chat_turn.terminal_ms AS terminalMs,
      chat_turn.terminal_at AS terminalAt,
      chat_turn.terminal_state AS terminalState,
      chat_turn.duration_ms AS durationMs,
      chat_turn.model,
      chat_turn.reasoning_effort AS reasoningEffort,
      chat_turn.service_tier AS serviceTier,
      source.thread_created_ms AS threadCreatedMs
     FROM usage_chat_turns AS chat_turn
     INNER JOIN usage_source_files AS source ON source.session_id = chat_turn.source_session_id
     WHERE (chat_turn.turn_id, chat_turn.started_ms, source.thread_created_ms, chat_turn.source_session_id)
       > (?, ?, ?, ?)
     ORDER BY chat_turn.turn_id ASC, chat_turn.started_ms ASC, source.thread_created_ms ASC,
       chat_turn.source_session_id ASC
     LIMIT ?`,
  );
  let cursor = { turnId: '', startedMs: -1, threadCreatedMs: -1, sessionId: '' };
  while (true) {
    const rows = z
      .array(storedChatTurnRowSchema)
      .max(CODEX_USAGE_EVENT_PAGE_SIZE)
      .parse(
        statement.all(
          cursor.turnId,
          cursor.startedMs,
          cursor.threadCreatedMs,
          cursor.sessionId,
          CODEX_USAGE_EVENT_PAGE_SIZE,
        ),
      );
    if (!rows.length) return;
    yield rows;
    const last = rows.at(-1);
    if (!last || rows.length < CODEX_USAGE_EVENT_PAGE_SIZE) return;
    cursor = last;
  }
}

export function* sessionAnalysisEventPages(
  database: Database.Database,
  turns: readonly [sessionId: string, turnId: string][],
): Iterable<ReadonlyArray<CodexUsageInternalEvent>> {
  if (!turns.length) return;
  const statement = database.prepare(
    `SELECT
      event.source_session_id AS sessionId,
      event.event_order AS eventOrder,
      event.event_fingerprint AS eventFingerprint,
      event.turn_id AS turnId,
      event.timestamp_ms AS timestampMs,
      event.timestamp,
      event.model,
      event.service_tier AS serviceTier,
      event.service_tier_inferred AS serviceTierInferred,
      event.quota_kind AS quotaKind,
      event.limit_id AS limitId,
      event.plan_type AS planType,
      event.used_percent AS usedPercent,
      event.window_duration_mins AS windowDurationMins,
      event.resets_at AS resetsAt,
      event.secondary_used_percent AS secondaryUsedPercent,
      event.secondary_window_duration_mins AS secondaryWindowDurationMins,
      event.secondary_resets_at AS secondaryResetsAt,
      event.input_tokens AS inputTokens,
      event.cached_input_tokens AS cachedInputTokens,
      event.cache_write_input_tokens AS cacheWriteInputTokens,
      event.output_tokens AS outputTokens,
      event.reasoning_output_tokens AS reasoningOutputTokens,
      event.total_tokens AS totalTokens
     FROM usage_events AS event
     WHERE event.total_tokens > 0
       AND (event.source_session_id, event.turn_id) IN (
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)
       )
     ORDER BY event.source_session_id ASC, event.event_order ASC`,
  );
  for (const rows of sqlitePages(statement.iterate(JSON.stringify(turns)), storedEventRowSchema)) {
    yield rows.map(eventFromStoredRow);
  }
}
