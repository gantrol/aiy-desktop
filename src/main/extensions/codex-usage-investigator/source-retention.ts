import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { CodexUsageFileFingerprint } from '@/main/extensions/codex-usage-investigator/cache-records';
import type {
  CodexUsageInternalEvent,
  SessionReadResult,
} from '@/main/extensions/codex-usage-investigator/session-reader';

const sourceSchema = z.object({
  size_bytes: z.number(),
  mtime_ns: z.string(),
  ctime_ns: z.string(),
  event_count: z.number(),
  first_event_ms: z.number().nullable(),
  last_event_ms: z.number().nullable(),
  history_retained: z.number(),
  context_compaction_count: z.number(),
  turn_metadata_complete: z.number(),
});
const offsetSchema = z.object({ offset: z.number().int().nonnegative().safe() });

/** A rewritten rollout is no longer authoritative for events it has discarded. */
export function readSourceRetention(
  database: Database.Database,
  file: CodexUsageFileFingerprint,
  result: SessionReadResult,
) {
  const previous = sourceSchema.nullable().parse(
    database
      .prepare(
        `SELECT size_bytes, mtime_ns, ctime_ns, event_count,
      first_event_ms, last_event_ms, history_retained, context_compaction_count, turn_metadata_complete
      FROM usage_source_files WHERE session_id = ?`,
      )
      .get(file.sessionId) ?? null,
  );
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const event of result.events) {
    const timestamp = Date.parse(event.timestamp);
    first = Math.min(first, timestamp);
    last = Math.max(last, timestamp);
  }
  const changed =
    previous &&
    (previous.size_bytes !== file.size || previous.mtime_ns !== file.mtimeNs || previous.ctime_ns !== file.ctimeNs);
  const contracted =
    previous &&
    (file.size < previous.size_bytes ||
      result.events.length < previous.event_count ||
      first > (previous.first_event_ms ?? first) ||
      last < (previous.last_event_ms ?? last));
  const keepHistory = Boolean(
    previous &&
    (previous.history_retained || (previous.event_count > 0 && (!result.events.length || (changed && contracted)))),
  );
  return {
    keepHistory,
    contextCompactionCount: keepHistory ? previous!.context_compaction_count : 0,
    turnMetadataComplete: !keepHistory || previous!.turn_metadata_complete === 1,
  };
}

export function prepareSourceReplacement(
  database: Database.Database,
  sessionId: string,
  events: readonly CodexUsageInternalEvent[],
  keepHistory: boolean,
) {
  if (!keepHistory) {
    database.prepare('DELETE FROM usage_events WHERE source_session_id = ?').run(sessionId);
    database.prepare('DELETE FROM usage_chat_turns WHERE source_session_id = ?').run(sessionId);
    return { eventOffset: 0, turnOffset: 0 };
  }
  // Several requests can share a millisecond, especially in replayed histories.
  // Match usage as well as time, and replace only as many occurrences as were read.
  const replacements = new Map<string, { event: CodexUsageInternalEvent; count: number }>();
  for (const event of events) {
    const key = JSON.stringify([event.timestamp, event.usage, event.usage.totalTokens ? null : event.eventFingerprint]);
    const existing = replacements.get(key);
    if (existing) existing.count++;
    else replacements.set(key, { event, count: 1 });
  }
  const replaceEvent = database.prepare(`DELETE FROM usage_events WHERE rowid IN (
    SELECT rowid FROM usage_events WHERE source_session_id = @sessionId AND timestamp_ms = @timestamp
      AND input_tokens = @input AND cached_input_tokens = @cached AND cache_write_input_tokens = @write
      AND output_tokens = @output AND reasoning_output_tokens = @reasoning AND total_tokens = @total
      AND (@total > 0 OR event_fingerprint = @fingerprint)
    ORDER BY event_order LIMIT @count
  )`);
  for (const { event, count } of replacements.values()) {
    replaceEvent.run({
      sessionId,
      timestamp: Date.parse(event.timestamp),
      count,
      input: event.usage.inputTokens,
      cached: event.usage.cachedInputTokens,
      write: event.usage.cacheWriteInputTokens,
      output: event.usage.outputTokens,
      reasoning: event.usage.reasoningOutputTokens,
      total: event.usage.totalTokens,
      fingerprint: event.eventFingerprint,
    });
  }
  return {
    eventOffset: offsetSchema.parse(
      database
        .prepare('SELECT COALESCE(MAX(event_order) + 1, 0) AS offset FROM usage_events WHERE source_session_id = ?')
        .get(sessionId),
    ).offset,
    turnOffset: offsetSchema.parse(
      database
        .prepare('SELECT COALESCE(MAX(turn_order) + 1, 0) AS offset FROM usage_chat_turns WHERE source_session_id = ?')
        .get(sessionId),
    ).offset,
  };
}
