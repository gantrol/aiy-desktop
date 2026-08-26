import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import codexUsageCacheRevision3Sql from '@/main/database/sql/v03-codex-usage-cache-revision-003.sql?raw';
import codexUsageCacheRevision4Sql from '@/main/database/sql/v03-codex-usage-cache-revision-004.sql?raw';
import codexUsageCacheRevision5Sql from '@/main/database/sql/v03-codex-usage-cache-revision-005.sql?raw';
import {
  codexUsageCleanupCountsSchema,
  codexUsageHistoryItemSchema,
  codexUsageInvestigationSchema,
  codexUsageStateSchema,
  codexUsageTaskSchema,
  type CodexUsageCleanupCounts,
  type CodexUsageCleanupLevel,
  type CodexUsageHistoryItem,
  type CodexUsageInvestigation,
  type CodexUsageState,
  type CodexUsageTask,
} from '@/shared/contracts/codex-usage';
import {
  codexUsageInternalEventSchema,
  codexUsageInternalRowSchema,
  codexUsageSessionReadResultSchema,
  type CodexUsageInternalEvent,
  type CodexUsageInternalRow,
  type SessionReadResult,
} from '@/main/extensions/codex-usage-investigator/session-reader';
import type { CodexUsageServiceTierFallback } from '@/main/extensions/codex-usage-investigator/service-tier-fallback';

const DATABASE_SCHEMA_VERSION = 5;
const SOURCE_ANALYSIS_VERSION = 6;
const MAX_TASK_JSON_BYTES = 256 * 1024;
const MAX_HISTORY_JSON_BYTES = 64 * 1024;
const MAX_INVESTIGATION_JSON_BYTES = 32 * 1024 * 1024;
const MAX_EXPORT_ROWS_JSON_BYTES = 256 * 1024 * 1024;
const MAX_PROCESSED_JSON_BYTES = 256 * 1024 * 1024;
const EVENT_PAGE_SIZE = 2_000;

const taskRowSchema = z.object({ taskJson: z.string() }).strict();
const historyRowSchema = z.object({ historyJson: z.string() }).strict();
const investigationLengthRowSchema = z.object({ investigationBytes: z.number().int().nonnegative() }).strict();
const investigationRowSchema = z.object({ investigationJson: z.string() }).strict();
const exportLengthRowSchema = z.object({ exportBytes: z.number().int().nonnegative() }).strict();
const exportRowSchema = z.object({ exportRowsJson: z.string() }).strict();
const sourceKeyRowSchema = z.object({ cacheKey: z.string() }).strict();
const revisionRowSchema = z.object({ dataRevision: z.number().int().nonnegative().safe() }).strict();
const sqliteTableInfoRowSchema = z.object({ name: z.string() }).passthrough();
const processedRowSchema = z
  .object({ dataRevision: z.number().int().nonnegative().safe(), payloadJson: z.string() })
  .strict();
const coverageRowSchema = z
  .object({
    storedFrom: z.string().nullable(),
    storedTo: z.string().nullable(),
    storedSessionCount: z.number().int().nonnegative().safe(),
    sourceEventCount: z.number().int().nonnegative().safe(),
  })
  .strict();
const storedEventRowSchema = z
  .object({
    sessionId: z.string(),
    eventOrder: z.number().int().nonnegative().safe(),
    eventFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    timestampMs: z.number().int().nonnegative().safe(),
    timestamp: z.string(),
    model: z.string(),
    serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']),
    serviceTierInferred: z.union([z.literal(0), z.literal(1)]),
    quotaKind: z.enum(['MAIN', 'SEPARATE', 'UNKNOWN']),
    limitId: z.string().nullable(),
    planType: z.string().nullable(),
    usedPercent: z.number().finite().nonnegative().nullable(),
    windowDurationMins: z.number().finite().nonnegative().nullable(),
    resetsAt: z.number().int().nonnegative().safe().nullable(),
    secondaryUsedPercent: z.number().finite().nonnegative().nullable(),
    secondaryWindowDurationMins: z.number().finite().nonnegative().nullable(),
    secondaryResetsAt: z.number().int().nonnegative().safe().nullable(),
    inputTokens: z.number().int().nonnegative().safe(),
    cachedInputTokens: z.number().int().nonnegative().safe(),
    cacheWriteInputTokens: z.number().int().nonnegative().safe(),
    outputTokens: z.number().int().nonnegative().safe(),
    reasoningOutputTokens: z.number().int().nonnegative().safe(),
    totalTokens: z.number().int().nonnegative().safe(),
  })
  .strict();

type StoredEventRow = z.infer<typeof storedEventRowSchema>;

function eventFromStoredRow(row: StoredEventRow): CodexUsageInternalEvent {
  return codexUsageInternalEventSchema.parse({
    sessionId: row.sessionId,
    eventFingerprint: row.eventFingerprint,
    timestamp: row.timestamp,
    model: row.model,
    serviceTier: row.serviceTier,
    serviceTierInferred: row.serviceTierInferred === 1,
    quotaKind: row.quotaKind,
    limitId: row.limitId,
    planType: row.planType,
    usedPercent: row.usedPercent,
    windowDurationMins: row.windowDurationMins,
    resetsAt: row.resetsAt,
    secondaryUsedPercent: row.secondaryUsedPercent,
    secondaryWindowDurationMins: row.secondaryWindowDurationMins,
    secondaryResetsAt: row.secondaryResetsAt,
    usage: {
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      cacheWriteInputTokens: row.cacheWriteInputTokens,
      outputTokens: row.outputTokens,
      reasoningOutputTokens: row.reasoningOutputTokens,
      totalTokens: row.totalTokens,
    },
  });
}

export interface CodexUsageFileFingerprint {
  sessionId: string;
  fallbackModel: string | null;
  size: number;
  mtimeMs: number;
  mtimeNs: string;
  ctimeNs: string;
}

export interface CodexUsageEventCoverage {
  storedFrom: string | null;
  storedTo: string | null;
  storedSessionCount: number;
  sourceEventCount: number;
}

function parseBoundedJson<T>(encoded: string, maximumBytes: number, schema: z.ZodType<T>) {
  if (Buffer.byteLength(encoded, 'utf8') > maximumBytes) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded) as unknown;
  } catch {
    return null;
  }
  const parsed = schema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

function historyItem(investigation: CodexUsageInvestigation): CodexUsageHistoryItem {
  return codexUsageHistoryItemSchema.parse({
    investigationId: investigation.investigationId,
    generatedAt: investigation.generatedAt,
    range: investigation.range,
    timeZone: investigation.timeZone,
    granularity: investigation.granularity,
    algorithmVersion: investigation.quotaYield?.algorithmVersion ?? 7,
    yieldEstimateCount: investigation.quotaYield?.estimates.length ?? 0,
    yieldSampleCount: investigation.quotaYield?.samples.length ?? 0,
    from: investigation.from,
    to: investigation.to,
    sessionCount: investigation.sessionCount,
    requestCount: investigation.requestCount,
    totalTokens: investigation.totals.totalTokens,
    apiEquivalentUsd: investigation.totals.apiEquivalentUsd,
    filesScanned: investigation.filesScanned,
    filesCached: investigation.filesCached,
    bytesRead: investigation.bytesRead,
    durationMs: investigation.durationMs,
  });
}

export function codexUsageSourceCacheKey(
  file: CodexUsageFileFingerprint,
  serviceTierFallback?: CodexUsageServiceTierFallback | null,
) {
  const applicableFallback =
    serviceTierFallback && file.mtimeMs >= serviceTierFallback.effectiveFromEpoch ? serviceTierFallback : null;
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: SOURCE_ANALYSIS_VERSION,
        sessionId: file.sessionId,
        fallbackModel: file.fallbackModel,
        size: file.size,
        mtimeNs: file.mtimeNs,
        ctimeNs: file.ctimeNs,
        serviceTierFallback: applicableFallback
          ? {
              serviceTier: applicableFallback.serviceTier,
              effectiveFromEpoch: applicableFallback.effectiveFromEpoch,
              sourceRevision: applicableFallback.sourceRevision,
            }
          : null,
      }),
      'utf8',
    )
    .digest('hex');
}

export class CodexUsageCacheDatabase {
  private readonly database: Database.Database;

  constructor(directory: string) {
    const root = path.resolve(directory);
    mkdirSync(root, { recursive: true });
    this.database = new Database(path.join(root, 'usage-cache.sqlite'), { timeout: 5_000 });
    const journalMode = z
      .string()
      .parse(this.database.pragma('journal_mode', { simple: true }))
      .toLowerCase();
    if (journalMode !== 'wal') this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = NORMAL');
    this.database.pragma('foreign_keys = ON');
    this.migrate();
    this.recoverInterruptedTasks();
  }

  state(): CodexUsageState {
    return codexUsageStateSchema.parse({ task: this.latestPendingTask(), history: this.listHistory() });
  }

  cleanup(level: CodexUsageCleanupLevel): CodexUsageCleanupCounts {
    return this.database.transaction(() => {
      const removed: CodexUsageCleanupCounts = {
        scanTasks: 0,
        processedResults: 0,
        sessionAnalyses: 0,
        sourceFiles: 0,
        usageEvents: 0,
      };
      removed.scanTasks =
        level === 'HISTORY'
          ? this.database
              .prepare("DELETE FROM scan_tasks WHERE status NOT IN ('RUNNING', 'PAUSED', 'INTERRUPTED')")
              .run().changes
          : this.database.prepare('DELETE FROM scan_tasks').run().changes;
      if (level !== 'HISTORY') {
        removed.processedResults = this.database.prepare('DELETE FROM usage_processed_cache').run().changes;
        removed.sessionAnalyses = this.database.prepare('DELETE FROM session_analysis_cache').run().changes;
      }
      if (level === 'LOCAL_INDEX') {
        removed.usageEvents = this.database.prepare('DELETE FROM usage_events').run().changes;
        removed.sourceFiles = this.database.prepare('DELETE FROM usage_source_files').run().changes;
        this.database.prepare('UPDATE usage_ingestion_meta SET data_revision = data_revision + 1 WHERE id = 1').run();
      }
      return codexUsageCleanupCountsSchema.parse(removed);
    })();
  }

  createTask(task: CodexUsageTask) {
    const parsed = codexUsageTaskSchema.parse(task);
    this.database
      .prepare(
        `INSERT INTO scan_tasks (
          task_id, status, updated_at, task_json, investigation_json, history_json, export_rows_json
        ) VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .run(parsed.taskId, parsed.status, parsed.updatedAt, JSON.stringify(parsed));
  }

  saveTask(task: CodexUsageTask) {
    const parsed = codexUsageTaskSchema.parse(task);
    const encoded = JSON.stringify(parsed);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_TASK_JSON_BYTES) {
      throw new Error('Codex usage task state is too large');
    }
    this.database
      .prepare('UPDATE scan_tasks SET status = ?, updated_at = ?, task_json = ? WHERE task_id = ?')
      .run(parsed.status, parsed.updatedAt, encoded, parsed.taskId);
  }

  task(taskId: string) {
    const row = taskRowSchema.safeParse(
      this.database.prepare('SELECT task_json AS taskJson FROM scan_tasks WHERE task_id = ?').get(taskId),
    );
    if (!row.success) return null;
    return parseBoundedJson(row.data.taskJson, MAX_TASK_JSON_BYTES, codexUsageTaskSchema);
  }

  latestResumableTask() {
    const row = taskRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT task_json AS taskJson
           FROM scan_tasks
           WHERE status = 'INTERRUPTED'
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get(),
    );
    if (!row.success) return null;
    return parseBoundedJson(row.data.taskJson, MAX_TASK_JSON_BYTES, codexUsageTaskSchema);
  }

  cancelPendingTasks(exceptTaskId?: string) {
    const rows = z.array(taskRowSchema).safeParse(
      this.database
        .prepare(
          `SELECT task_json AS taskJson
           FROM scan_tasks
           WHERE status IN ('RUNNING', 'PAUSED', 'INTERRUPTED')
             AND (? IS NULL OR task_id <> ?)`,
        )
        .all(exceptTaskId ?? null, exceptTaskId ?? null),
    );
    if (!rows.success) return;
    for (const row of rows.data) {
      const task = parseBoundedJson(row.taskJson, MAX_TASK_JSON_BYTES, codexUsageTaskSchema);
      if (!task) continue;
      this.saveTask({ ...task, status: 'CANCELLED', updatedAt: new Date().toISOString(), errorMessage: null });
    }
  }

  hasIngestedSource(file: CodexUsageFileFingerprint, serviceTierFallback?: CodexUsageServiceTierFallback | null) {
    const row = sourceKeyRowSchema.safeParse(
      this.database
        .prepare('SELECT cache_key AS cacheKey FROM usage_source_files WHERE session_id = ?')
        .get(file.sessionId),
    );
    return row.success && row.data.cacheKey === codexUsageSourceCacheKey(file, serviceTierFallback);
  }

  replaceIngestedSource(
    file: CodexUsageFileFingerprint,
    result: SessionReadResult,
    serviceTierFallback?: CodexUsageServiceTierFallback | null,
  ) {
    const parsed = codexUsageSessionReadResultSchema.parse(result);
    const events = [...parsed.events].sort(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.model.localeCompare(right.model),
    );
    const cacheKey = codexUsageSourceCacheKey(file, serviceTierFallback);
    const firstEventMs = events.length ? Date.parse(events[0]!.timestamp) : null;
    const lastEventMs = events.length ? Date.parse(events.at(-1)!.timestamp) : null;
    const updatedAt = new Date().toISOString();
    const upsertSource = this.database.prepare(
      `INSERT INTO usage_source_files (
        session_id, cache_key, size_bytes, mtime_ns, ctime_ns, first_event_ms, last_event_ms,
        event_count, invalid_records, oversized_records, bytes_read, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        cache_key = excluded.cache_key,
        size_bytes = excluded.size_bytes,
        mtime_ns = excluded.mtime_ns,
        ctime_ns = excluded.ctime_ns,
        first_event_ms = excluded.first_event_ms,
        last_event_ms = excluded.last_event_ms,
        event_count = excluded.event_count,
        invalid_records = excluded.invalid_records,
        oversized_records = excluded.oversized_records,
        bytes_read = excluded.bytes_read,
        updated_at = excluded.updated_at`,
    );
    const insertEvent = this.database.prepare(
      `INSERT INTO usage_events (
        source_session_id, event_order, event_fingerprint, timestamp_ms, timestamp, model,
        service_tier, service_tier_inferred, quota_kind,
        limit_id, plan_type, used_percent, window_duration_mins, resets_at,
        secondary_used_percent, secondary_window_duration_mins, secondary_resets_at,
        input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens,
        reasoning_output_tokens, total_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.database.transaction(() => {
      upsertSource.run(
        file.sessionId,
        cacheKey,
        file.size,
        file.mtimeNs,
        file.ctimeNs,
        firstEventMs,
        lastEventMs,
        events.length,
        parsed.invalidRecords,
        parsed.oversizedRecords,
        parsed.bytesRead,
        updatedAt,
      );
      this.database.prepare('DELETE FROM usage_events WHERE source_session_id = ?').run(file.sessionId);
      events.forEach((event, eventOrder) => {
        insertEvent.run(
          file.sessionId,
          eventOrder,
          event.eventFingerprint,
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
      this.database.prepare('UPDATE usage_ingestion_meta SET data_revision = data_revision + 1 WHERE id = 1').run();
      this.database.prepare('DELETE FROM usage_processed_cache').run();
    })();
  }

  eventCoverage(fromEpoch: number | null = null, toEpoch: number = Number.MAX_SAFE_INTEGER): CodexUsageEventCoverage {
    return coverageRowSchema.parse(
      this.database
        .prepare(
          `SELECT
            MIN(timestamp) AS storedFrom,
            MAX(timestamp) AS storedTo,
            COUNT(DISTINCT source_session_id) AS storedSessionCount,
            COUNT(*) AS sourceEventCount
           FROM usage_events
           WHERE timestamp_ms >= COALESCE(?, 0) AND timestamp_ms <= ?`,
        )
        .get(fromEpoch, toEpoch),
    );
  }

  *eventPages(fromEpoch: number | null, toEpoch: number): Iterable<ReadonlyArray<CodexUsageInternalEvent>> {
    const statement = this.database.prepare(
      `SELECT
          current.source_session_id AS sessionId,
          current.event_order AS eventOrder,
          current.event_fingerprint AS eventFingerprint,
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
           AND (current.timestamp_ms, current.source_session_id, current.event_order) > (?, ?, ?)
           AND (
             current.total_tokens = 0
             OR NOT EXISTS (
               SELECT 1
               FROM usage_events AS previous
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
         ORDER BY current.timestamp_ms ASC, current.source_session_id ASC, current.event_order ASC
         LIMIT ?`,
    );
    let cursor: Pick<StoredEventRow, 'timestampMs' | 'sessionId' | 'eventOrder'> = {
      timestampMs: (fromEpoch ?? 0) - 1,
      sessionId: '',
      eventOrder: 0,
    };
    while (true) {
      const rows = z
        .array(storedEventRowSchema)
        .max(EVENT_PAGE_SIZE)
        .parse(
          statement.all(fromEpoch, toEpoch, cursor.timestampMs, cursor.sessionId, cursor.eventOrder, EVENT_PAGE_SIZE),
        );
      if (!rows.length) return;
      yield rows.map(eventFromStoredRow);
      const last = rows.at(-1);
      if (!last || rows.length < EVENT_PAGE_SIZE) return;
      cursor = last;
    }
  }

  currentDataRevision() {
    return revisionRowSchema.parse(
      this.database.prepare('SELECT data_revision AS dataRevision FROM usage_ingestion_meta WHERE id = 1').get(),
    ).dataRevision;
  }

  readProcessed<T>(cacheKey: string, schema: z.ZodType<T>) {
    const row = processedRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT data_revision AS dataRevision, payload_json AS payloadJson
           FROM usage_processed_cache
           WHERE cache_key = ?`,
        )
        .get(cacheKey),
    );
    if (!row.success || row.data.dataRevision !== this.currentDataRevision()) return null;
    return parseBoundedJson(row.data.payloadJson, MAX_PROCESSED_JSON_BYTES, schema);
  }

  saveProcessed<T>(cacheKey: string, value: T, schema: z.ZodType<T>) {
    const parsed = schema.parse(value);
    const payloadJson = JSON.stringify(parsed);
    if (Buffer.byteLength(payloadJson, 'utf8') > MAX_PROCESSED_JSON_BYTES) return false;
    this.database
      .prepare(
        `INSERT OR REPLACE INTO usage_processed_cache (
          cache_key, data_revision, payload_json, updated_at
        ) VALUES (?, ?, ?, ?)`,
      )
      .run(cacheKey, this.currentDataRevision(), payloadJson, new Date().toISOString());
    return true;
  }

  completeTask(task: CodexUsageTask, investigation: CodexUsageInvestigation, rows: CodexUsageInternalRow[]) {
    const parsedTask = codexUsageTaskSchema.parse(task);
    const parsedInvestigation = codexUsageInvestigationSchema.parse(investigation);
    const parsedRows = z.array(codexUsageInternalRowSchema).max(100_000).parse(rows);
    const taskJson = JSON.stringify(parsedTask);
    const investigationJson = JSON.stringify(parsedInvestigation);
    const historyJson = JSON.stringify(historyItem(parsedInvestigation));
    const exportRowsJson = JSON.stringify(parsedRows);
    if (Buffer.byteLength(taskJson, 'utf8') > MAX_TASK_JSON_BYTES) {
      throw new Error('Codex usage task state is too large');
    }
    if (Buffer.byteLength(investigationJson, 'utf8') > MAX_INVESTIGATION_JSON_BYTES) {
      throw new Error('Codex usage investigation is too large');
    }
    if (Buffer.byteLength(historyJson, 'utf8') > MAX_HISTORY_JSON_BYTES) {
      throw new Error('Codex usage history item is too large');
    }
    if (Buffer.byteLength(exportRowsJson, 'utf8') > MAX_EXPORT_ROWS_JSON_BYTES) {
      throw new Error('Codex usage export rows are too large');
    }
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE scan_tasks
           SET status = ?, updated_at = ?, task_json = ?, investigation_json = ?, history_json = ?, export_rows_json = ?
           WHERE task_id = ?`,
        )
        .run(
          parsedTask.status,
          parsedTask.updatedAt,
          taskJson,
          investigationJson,
          historyJson,
          exportRowsJson,
          parsedTask.taskId,
        );
    })();
  }

  investigation(investigationId: string) {
    const length = investigationLengthRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT length(CAST(investigation_json AS BLOB)) AS investigationBytes
           FROM scan_tasks
           WHERE task_id = ? AND status = 'COMPLETED' AND investigation_json IS NOT NULL`,
        )
        .get(investigationId),
    );
    if (!length.success || length.data.investigationBytes > MAX_INVESTIGATION_JSON_BYTES) return null;
    const row = investigationRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT investigation_json AS investigationJson
           FROM scan_tasks
           WHERE task_id = ? AND status = 'COMPLETED' AND investigation_json IS NOT NULL`,
        )
        .get(investigationId),
    );
    if (!row.success) return null;
    return parseBoundedJson(row.data.investigationJson, MAX_INVESTIGATION_JSON_BYTES, codexUsageInvestigationSchema);
  }

  exportRows(investigationId: string) {
    const length = exportLengthRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT length(CAST(export_rows_json AS BLOB)) AS exportBytes
           FROM scan_tasks
           WHERE task_id = ? AND status = 'COMPLETED' AND export_rows_json IS NOT NULL`,
        )
        .get(investigationId),
    );
    if (!length.success || length.data.exportBytes > MAX_EXPORT_ROWS_JSON_BYTES) return null;
    const row = exportRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT export_rows_json AS exportRowsJson
           FROM scan_tasks
           WHERE task_id = ? AND status = 'COMPLETED' AND export_rows_json IS NOT NULL`,
        )
        .get(investigationId),
    );
    if (!row.success) return null;
    return parseBoundedJson(
      row.data.exportRowsJson,
      MAX_EXPORT_ROWS_JSON_BYTES,
      z.array(codexUsageInternalRowSchema).max(100_000),
    );
  }

  private latestPendingTask() {
    const row = taskRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT task_json AS taskJson
           FROM scan_tasks
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get(),
    );
    if (!row.success) return null;
    const task = parseBoundedJson(row.data.taskJson, MAX_TASK_JSON_BYTES, codexUsageTaskSchema);
    return task && ['RUNNING', 'PAUSED', 'INTERRUPTED', 'FAILED'].includes(task.status) ? task : null;
  }

  private listHistory() {
    const rows = z.array(historyRowSchema).safeParse(
      this.database
        .prepare(
          `SELECT history_json AS historyJson
           FROM scan_tasks
           WHERE status = 'COMPLETED' AND history_json IS NOT NULL
           ORDER BY updated_at DESC
           LIMIT 50`,
        )
        .all(),
    );
    if (!rows.success) return [];
    return rows.data.flatMap((row) => {
      const item = parseBoundedJson(row.historyJson, MAX_HISTORY_JSON_BYTES, codexUsageHistoryItemSchema);
      return item ? [item] : [];
    });
  }

  private recoverInterruptedTasks() {
    const rows = z
      .array(taskRowSchema)
      .safeParse(this.database.prepare("SELECT task_json AS taskJson FROM scan_tasks WHERE status = 'RUNNING'").all());
    if (!rows.success) return;
    for (const row of rows.data) {
      const task = parseBoundedJson(row.taskJson, MAX_TASK_JSON_BYTES, codexUsageTaskSchema);
      if (!task) continue;
      this.saveTask({ ...task, status: 'INTERRUPTED', updatedAt: new Date().toISOString() });
    }
  }

  private migrate() {
    const version = z
      .number()
      .int()
      .nonnegative()
      .parse(this.database.pragma('user_version', { simple: true }));
    if (version > DATABASE_SCHEMA_VERSION) throw new Error('Codex usage cache database is newer than this app');
    const hasEventFingerprintColumn = z
      .array(sqliteTableInfoRowSchema)
      .parse(this.database.pragma('table_info(usage_events)'))
      .some((column) => column.name === 'event_fingerprint');
    const hasServiceTierInferredColumn = z
      .array(sqliteTableInfoRowSchema)
      .parse(this.database.pragma('table_info(usage_events)'))
      .some((column) => column.name === 'service_tier_inferred');
    if (version === DATABASE_SCHEMA_VERSION && hasEventFingerprintColumn && hasServiceTierInferredColumn) return;
    this.database.transaction(() => {
      if (version < 1) {
        this.database.exec(
          `CREATE TABLE IF NOT EXISTS session_analysis_cache (
            cache_key TEXT NOT NULL,
            coverage_from_key TEXT NOT NULL,
            coverage_from_epoch INTEGER,
            coverage_to_epoch INTEGER NOT NULL,
            session_id TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            mtime_ns TEXT NOT NULL,
            ctime_ns TEXT NOT NULL,
            result_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (cache_key, coverage_from_key, coverage_to_epoch)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS session_analysis_cache_session_idx
            ON session_analysis_cache (session_id, updated_at DESC);
          CREATE TABLE IF NOT EXISTS scan_tasks (
            task_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            task_json TEXT NOT NULL,
            investigation_json TEXT,
            history_json TEXT,
            export_rows_json TEXT
          ) STRICT;
          CREATE INDEX IF NOT EXISTS scan_tasks_status_updated_idx
            ON scan_tasks (status, updated_at DESC);`,
        );
      }
      if (version < 2) {
        this.database.exec(
          `CREATE TABLE IF NOT EXISTS usage_ingestion_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data_revision INTEGER NOT NULL
          ) STRICT;
          INSERT OR IGNORE INTO usage_ingestion_meta (id, data_revision) VALUES (1, 0);
          CREATE TABLE IF NOT EXISTS usage_source_files (
            session_id TEXT PRIMARY KEY,
            cache_key TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            mtime_ns TEXT NOT NULL,
            ctime_ns TEXT NOT NULL,
            first_event_ms INTEGER,
            last_event_ms INTEGER,
            event_count INTEGER NOT NULL,
            invalid_records INTEGER NOT NULL,
            oversized_records INTEGER NOT NULL,
            bytes_read INTEGER NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;
          CREATE TABLE IF NOT EXISTS usage_events (
            source_session_id TEXT NOT NULL REFERENCES usage_source_files(session_id) ON DELETE CASCADE,
            event_order INTEGER NOT NULL,
            timestamp_ms INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            model TEXT NOT NULL,
            service_tier TEXT NOT NULL CHECK (service_tier IN ('STANDARD', 'FAST', 'UNKNOWN')),
            quota_kind TEXT NOT NULL CHECK (quota_kind IN ('MAIN', 'SEPARATE', 'UNKNOWN')),
            limit_id TEXT,
            plan_type TEXT,
            used_percent REAL,
            window_duration_mins REAL,
            resets_at INTEGER,
            input_tokens INTEGER NOT NULL,
            cached_input_tokens INTEGER NOT NULL,
            cache_write_input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            reasoning_output_tokens INTEGER NOT NULL,
            total_tokens INTEGER NOT NULL,
            PRIMARY KEY (source_session_id, event_order)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS usage_events_timestamp_idx
            ON usage_events (timestamp_ms, source_session_id, event_order);
          CREATE TABLE IF NOT EXISTS usage_processed_cache (
            cache_key TEXT PRIMARY KEY,
            data_revision INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;`,
        );
      }
      if (version < 3) this.database.exec(codexUsageCacheRevision3Sql);
      if (!hasEventFingerprintColumn) this.database.exec(codexUsageCacheRevision4Sql);
      if (!hasServiceTierInferredColumn) this.database.exec(codexUsageCacheRevision5Sql);
      this.database.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
    })();
  }
}
