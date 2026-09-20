import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  calendarUsageQuerySchema,
  calendarUsageRunsQuerySchema,
  calendarUsageSourceValues,
  type CalendarUsageCoverageNote,
  type CalendarUsageDay,
  type CalendarUsageGroup,
  type CalendarUsageModel,
  type CalendarUsageQuery,
  type CalendarUsageResult,
  type CalendarUsageRun,
  type CalendarUsageRunsQuery,
  type CalendarUsageRunsResult,
  type CalendarUsageSourceCoverage,
  type CalendarUsageTarget,
  type CalendarUsageTotals,
} from '@/shared/calendar-usage';
import type { CalendarEntityRef } from '@/shared/contracts/calendar';
import { calendarDateRangeEpochs, calendarLocalDate } from '@/main/database/calendar/calendar-time';
import { CalendarSourceReader } from '@/main/database/calendar/calendar-sources';
import {
  calendarTokenFields,
  calendarUsageDefinitions,
  calendarUsageRows,
  calendarUsageTables,
  prepareCalendarUsageSource,
  type CalendarTokenField,
  type CalendarUsagePosition,
  type CalendarUsageRow,
  type CalendarUsageSourceRead,
} from '@/main/database/calendar/calendar-usage-rows';

type TokenValues = Record<CalendarTokenField, number | null>;
const connectionIds = new WeakMap<Database.Database, string>();
const cursorSchema = z
  .object({
    key: z.string().length(64),
    snapshot: z.string().length(64),
    at: z.string().min(1).max(100),
    source: z.enum(calendarUsageSourceValues),
    id: z.string().min(1).max(200),
  })
  .strict();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const binaryCompare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const fail = (code: string): never => {
  throw new Error(code);
};

/** Called by schema upgrade, never by a read. */
export function ensureCalendarUsageIndexes(db: Database.Database) {
  const tables = calendarUsageTables(db);
  for (const definition of Object.values(calendarUsageDefinitions)) {
    if (!tables.has(definition.table)) continue;
    db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_usage_${definition.table}_started
      ON ${definition.table}(started_at, id)`);
  }
}

function emptyTotals(): CalendarUsageTotals {
  return {
    runCount: 0,
    failedRunCount: 0,
    activeRunCount: 0,
    notStartedRunCount: 0,
    usageKnownRunCount: 0,
    usageMissingRunCount: 0,
    usagePartialRunCount: 0,
    knownInputTokens: null,
    knownCachedInputTokens: null,
    knownOutputTokens: null,
    knownReasoningOutputTokens: null,
    knownTotalTokens: null,
  };
}

/**
 * Connection-local change counters cover all source writes, including token
 * completion with no change_event. Other connections are covered by data_version.
 * Conservatively invalidate after unrelated writes too; do not mix read versions.
 * The connection nonce prevents accepting counters from a replacement connection.
 */
function databaseSnapshot(db: Database.Database, tables: Set<string>) {
  let connectionId = connectionIds.get(db);
  if (!connectionId) {
    connectionId = randomUUID();
    connectionIds.set(db, connectionId);
  }
  return hash({
    connectionId,
    instanceId: tables.has('calendar_state')
      ? (db.prepare('SELECT instance_id FROM calendar_state WHERE id=1').pluck().get() ?? null)
      : null,
    spaceId: tables.has('local_spaces')
      ? (db.prepare('SELECT id FROM local_spaces WHERE singleton_key=1').pluck().get() ?? null)
      : null,
    dataVersion: db.pragma('data_version', { simple: true }),
    schemaVersion: db.pragma('schema_version', { simple: true }),
    totalChanges: db.prepare('SELECT total_changes()').pluck().get(),
  });
}

function normalizeTokens(row: CalendarUsageRow, notes: Set<CalendarUsageCoverageNote>): TokenValues {
  const values = {} as TokenValues;
  for (const field of calendarTokenFields) {
    const value = row[field];
    values[field] = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (value !== null && value !== undefined && values[field] === null) notes.add('INVALID_TOKEN_VALUES');
  }
  if (row.usageAvailability === 'NOT_STARTED') {
    if (calendarTokenFields.some((field) => values[field] !== null)) notes.add('INVALID_TOKEN_VALUES');
    for (const field of calendarTokenFields) values[field] = null;
    return values;
  }
  if (
    values.knownCachedInputTokens !== null &&
    values.knownInputTokens !== null &&
    values.knownCachedInputTokens > values.knownInputTokens
  ) {
    values.knownCachedInputTokens = null;
    notes.add('INVALID_TOKEN_VALUES');
  }
  if (
    values.knownReasoningOutputTokens !== null &&
    values.knownOutputTokens !== null &&
    values.knownReasoningOutputTokens > values.knownOutputTokens
  ) {
    values.knownReasoningOutputTokens = null;
    notes.add('INVALID_TOKEN_VALUES');
  }
  if (
    values.knownTotalTokens !== null &&
    values.knownTotalTokens < (values.knownInputTokens ?? 0) + (values.knownOutputTokens ?? 0)
  ) {
    values.knownTotalTokens = null;
    notes.add('INVALID_TOKEN_VALUES');
  }
  // Cached input and reasoning output are subsets, never added a second time.
  if (values.knownTotalTokens === null && values.knownInputTokens !== null && values.knownOutputTokens !== null) {
    const total = values.knownInputTokens + values.knownOutputTokens;
    if (Number.isSafeInteger(total)) values.knownTotalTokens = total;
    else notes.add('TOKEN_SUM_OVERFLOW');
  }
  return values;
}

function runFromRow(
  read: CalendarUsageSourceRead,
  row: CalendarUsageRow,
  timeZone: string,
  fromEpoch: number,
  toEpoch: number,
): CalendarUsageRun | null {
  const epoch = Date.parse(row.startedAt);
  if (!Number.isFinite(epoch) || epoch < fromEpoch || epoch >= toEpoch) {
    read.notes.add('INVALID_START_TIME');
    return null;
  }
  // Per-run evidence must not inherit invalid values found in an earlier run.
  const notes = new Set(calendarUsageDefinitions[read.source].notes);
  if (read.notes.has('SOURCE_COLUMNS_MISSING')) notes.add('SOURCE_COLUMNS_MISSING');
  const values = normalizeTokens(row, notes);
  const target = row.targetType && row.targetId ? { type: row.targetType, id: row.targetId } : null;
  if (!target) notes.add('TARGET_NOT_RECORDED');
  let finishedAt: string | null = null;
  if (row.finishedAt !== null) {
    const end = Date.parse(row.finishedAt);
    if (Number.isFinite(end) && end >= epoch) finishedAt = new Date(end).toISOString();
    else notes.add('INVALID_FINISH_TIME');
  }
  const known = calendarTokenFields.some((field) => values[field] !== null);
  const partial =
    known &&
    (values.knownTotalTokens === null ||
      row.usageAvailability !== 'PROVIDED' ||
      ['FAILED', 'CANCELLED', 'INTERRUPTED', 'RUNNING', 'QUEUED'].includes(row.status) ||
      notes.has('MULTI_STAGE_SUBTOTAL') ||
      notes.has('INVALID_TOKEN_VALUES') ||
      notes.has('TOKEN_SUM_OVERFLOW'));
  for (const note of notes) read.notes.add(note);
  return {
    source: read.source,
    runId: row.id,
    date: calendarLocalDate(epoch, timeZone),
    startedAt: new Date(epoch).toISOString(),
    finishedAt,
    status: row.status,
    requestedModel: row.requestedModel,
    observedModel: row.observedModel,
    target,
    targetBasis: target ? read.targetBasis : 'UNASSIGNED',
    originalRun: { type: read.entityType, id: row.id },
    ...values,
    usageState: !known ? 'MISSING' : partial ? 'PARTIAL' : 'KNOWN',
    notes: [...notes],
  };
}

class UsageAccumulator {
  private readonly overflowed = new WeakMap<CalendarUsageTotals, Set<CalendarTokenField>>();
  add(target: CalendarUsageTotals, run: CalendarUsageRun, notes: Set<CalendarUsageCoverageNote>) {
    target.runCount += 1;
    target.failedRunCount += Number(['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.status));
    target.activeRunCount += Number(['RUNNING', 'QUEUED'].includes(run.status));
    target.notStartedRunCount += Number(['NOT_STARTED', 'BLOCKED'].includes(run.status));
    target.usageKnownRunCount += Number(run.usageState !== 'MISSING');
    target.usageMissingRunCount += Number(run.usageState === 'MISSING');
    target.usagePartialRunCount += Number(run.usageState === 'PARTIAL');
    for (const field of calendarTokenFields) {
      const value = run[field];
      if (value === null || this.overflowed.get(target)?.has(field)) continue;
      const sum = (target[field] ?? 0) + value;
      if (Number.isSafeInteger(sum)) target[field] = sum;
      else {
        target[field] = null;
        const fields = this.overflowed.get(target) ?? new Set<CalendarTokenField>();
        fields.add(field);
        this.overflowed.set(target, fields);
        notes.add('TOKEN_SUM_OVERFLOW');
      }
    }
  }
}

function coverage(sources: CalendarUsageSourceRead[]): CalendarUsageRunsResult['coverage'] {
  return {
    scope: 'LOCAL_LIBRARY_RUNS',
    tokenSemantics: 'KNOWN_SUBTOTAL',
    billing: 'NOT_AVAILABLE',
    externalSessions: 'NOT_READ',
    historicalUnobservedChats: 'NOT_INCLUDED',
    sources: sources.map((read): CalendarUsageSourceCoverage => ({
      ...read.coverage,
      notes: [...read.notes],
    })),
  };
}

function targetMetadata(
  reader: CalendarSourceReader,
  target: CalendarEntityRef | null,
  notes: Set<CalendarUsageCoverageNote>,
): Pick<CalendarUsageTarget, 'title' | 'titleBasis' | 'available' | 'navigateTo'> {
  const missing = { title: '', titleBasis: 'UNAVAILABLE' as const, available: false, navigateTo: null };
  if (!target) return missing;
  try {
    const value = reader.read(target);
    if (!value.available) return missing;
    return { title: value.title, titleBasis: 'CURRENT', available: value.available, navigateTo: value.navigateTo };
  } catch (error) {
    // Older/minimal spaces may lack optional source metadata tables. Do not
    // fall back to retained payloads or swallow corruption/I/O errors.
    if (error instanceof Error && /^no such (?:table|column):/.test(error.message)) {
      notes.add('TARGET_METADATA_UNAVAILABLE');
      return missing;
    }
    throw error;
  }
}

function queryContext(db: Database.Database, query: CalendarUsageQuery) {
  const tables = calendarUsageTables(db);
  const snapshot = databaseSnapshot(db, tables);
  if (query.snapshot && query.snapshot !== snapshot) fail('CALENDAR_USAGE_CURSOR_STALE');
  const sources = [...new Set(query.sources ?? calendarUsageSourceValues)].sort(binaryCompare);
  const range = calendarDateRangeEpochs(query.startDate, query.endDate, query.timeZone);
  return {
    snapshot,
    sources: sources.map((source) => prepareCalendarUsageSource(db, tables, source)),
    from: new Date(range.fromEpoch).toISOString(),
    to: new Date(range.toEpoch).toISOString(),
    ...range,
  };
}

/** Offline projection of existing local run headers; never writes a consumption ledger. */
export function listCalendarUsage(db: Database.Database, input: CalendarUsageQuery): CalendarUsageResult {
  const query = calendarUsageQuerySchema.parse(input);
  const read = (): CalendarUsageResult => {
    const context = queryContext(db, query);
    const limit = query.limitPerSource ?? 2_000;
    const totals = emptyTotals();
    const days = new Map<string, CalendarUsageDay>();
    const models = new Map<string, CalendarUsageModel>();
    const groups = new Map<string, CalendarUsageGroup>();
    const targets = new Map<string, CalendarUsageTarget>();
    const accumulator = new UsageAccumulator();
    const sourceReader = new CalendarSourceReader(db);
    let groupsTruncated = false;
    let targetsTruncated = false;
    for (const source of context.sources) {
      if (!source.coverage.available) continue;
      let scanned = 0;
      for (const row of calendarUsageRows(db, source, query, context.from, context.to, null, limit + 1)) {
        if (scanned++ >= limit) {
          source.coverage.truncated = true;
          break;
        }
        const run = runFromRow(source, row, query.timeZone, context.fromEpoch, context.toEpoch);
        if (!run) continue;
        const day = days.get(run.date) ?? { ...emptyTotals(), date: run.date };
        days.set(run.date, day);
        const modelKey = JSON.stringify([run.source, run.requestedModel, run.observedModel]);
        const model = models.get(modelKey) ?? {
          ...emptyTotals(),
          source: run.source,
          requestedModel: run.requestedModel,
          observedModel: run.observedModel,
        };
        models.set(modelKey, model);
        const targetKey = JSON.stringify(run.target);
        const groupKey = JSON.stringify([run.date, modelKey, targetKey]);
        let group = groups.get(groupKey);
        if (!group && groups.size < 2000) {
          group = {
            ...emptyTotals(),
            date: run.date,
            source: run.source,
            requestedModel: run.requestedModel,
            observedModel: run.observedModel,
            target: run.target,
          };
          groups.set(groupKey, group);
        }
        if (!group) groupsTruncated = true;
        let target = targets.get(targetKey);
        if (!target && targets.size < 500) {
          target = {
            ...emptyTotals(),
            target: run.target,
            ...targetMetadata(sourceReader, run.target, source.notes),
          };
          targets.set(targetKey, target);
        }
        if (!target) targetsTruncated = true;
        for (const subtotal of [totals, day, model, ...(group ? [group] : []), ...(target ? [target] : [])])
          accumulator.add(subtotal, run, source.notes);
        source.coverage.includedRunCount += 1;
      }
    }
    return {
      startDate: query.startDate,
      endDate: query.endDate,
      timeZone: query.timeZone,
      attribution: 'RUN_START',
      snapshot: context.snapshot,
      totals,
      days: [...days.values()].sort((left, right) => binaryCompare(left.date, right.date)),
      models: [...models.values()].sort(
        (left, right) =>
          right.runCount - left.runCount ||
          binaryCompare(left.source, right.source) ||
          binaryCompare(left.requestedModel ?? '', right.requestedModel ?? ''),
      ),
      groups: [...groups.values()].sort(
        (left, right) =>
          binaryCompare(left.date, right.date) ||
          binaryCompare(left.source, right.source) ||
          binaryCompare(left.requestedModel ?? '', right.requestedModel ?? '') ||
          binaryCompare(JSON.stringify(left.target), JSON.stringify(right.target)),
      ),
      targets: [...targets.values()].sort(
        (left, right) =>
          right.runCount - left.runCount || binaryCompare(JSON.stringify(left.target), JSON.stringify(right.target)),
      ),
      groupsTruncated,
      targetsTruncated,
      coverage: { ...coverage(context.sources), limitPerSource: limit },
      truncated: context.sources.some((source) => source.coverage.truncated),
    };
  };
  return db.inTransaction ? read() : db.transaction(read)();
}

function cursorKey(query: CalendarUsageRunsQuery, sources: CalendarUsageSourceRead[]) {
  return hash({
    startDate: query.startDate,
    endDate: query.endDate,
    timeZone: query.timeZone,
    sources: sources.map((source) => source.source),
    modelAttribution: query.modelAttribution ?? 'REQUESTED',
    model: query.model === undefined ? { any: true } : query.model,
    target: query.target === undefined ? { any: true } : query.target,
  });
}

/** Keyset pagination over original run records, independent of summary source caps. */
export function listCalendarUsageRuns(db: Database.Database, input: CalendarUsageRunsQuery): CalendarUsageRunsResult {
  const query = calendarUsageRunsQuerySchema.parse(input);
  const read = (): CalendarUsageRunsResult => {
    const context = queryContext(db, query);
    const limit = query.limit ?? 100;
    const key = cursorKey(query, context.sources);
    let position: CalendarUsagePosition | null = null;
    if (query.cursor) {
      let cursor: z.infer<typeof cursorSchema>;
      try {
        cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      } catch {
        return fail('CALENDAR_USAGE_CURSOR_INVALID');
      }
      if (cursor.key !== key) fail('CALENDAR_USAGE_CURSOR_INVALID');
      if (cursor.snapshot !== context.snapshot) fail('CALENDAR_USAGE_CURSOR_STALE');
      position = cursor;
    }
    const candidates: { run: CalendarUsageRun; position: CalendarUsagePosition }[] = [];
    for (const source of context.sources) {
      if (!source.coverage.available) continue;
      let validCount = 0;
      for (const row of calendarUsageRows(db, source, query, context.from, context.to, position)) {
        const run = runFromRow(source, row, query.timeZone, context.fromEpoch, context.toEpoch);
        if (!run) continue;
        candidates.push({ run, position: { at: row.startedAt, source: source.source, id: row.id } });
        if (++validCount > limit) break;
      }
    }
    candidates.sort(
      (left, right) =>
        binaryCompare(left.position.at, right.position.at) ||
        binaryCompare(left.position.source, right.position.source) ||
        binaryCompare(left.position.id, right.position.id),
    );
    const visible = candidates.slice(0, limit);
    const hasMore = candidates.length > limit;
    const last = visible.at(-1);
    for (const item of visible) {
      const source = context.sources.find((value) => value.source === item.run.source);
      if (source) source.coverage.includedRunCount += 1;
    }
    return {
      startDate: query.startDate,
      endDate: query.endDate,
      timeZone: query.timeZone,
      attribution: 'RUN_START',
      snapshot: context.snapshot,
      runs: visible.map((item) => item.run),
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(JSON.stringify({ key, snapshot: context.snapshot, ...last.position })).toString('base64url')
          : null,
      coverage: coverage(context.sources),
    };
  };
  return db.inTransaction ? read() : db.transaction(read)();
}
