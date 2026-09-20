import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  calendarActivityCorrectionSchema,
  calendarHistoryInputSchema,
  calendarHistoryResultSchema,
  calendarItemSchema,
  calendarPreferencesSchema,
  calendarQueryResultSchema,
  calendarQuerySchema,
  calendarSummaryQuerySchema,
  calendarSummaryResultSchema,
  type CalendarActivityCorrectionInput,
  type CalendarHistoryInput,
  type CalendarItem,
  type CalendarPreferencesInput,
  type CalendarQueryInput,
  type CalendarSummaryQueryInput,
  type CalendarTime,
} from '@/shared/contracts/calendar';
import { calendarCoverage } from '@/main/database/calendar/calendar-coverage';
import { calendarDateStartEpoch, calendarLocalDate } from '@/main/database/calendar/calendar-time';
import { calendarActivityItemFromReadRow } from '@/main/database/calendar/calendar-activity-item';
import { calendarCategorySql, CalendarSourceReader } from '@/main/database/calendar/calendar-sources';
import {
  readCalendarDayCounts,
  readCalendarRows,
  type CalendarReadFilter,
  type CalendarReadRow,
} from '@/main/database/calendar/calendar-read-rows';

const cursorSchema = z
  .object({
    key: z.string(),
    snapshot: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    at: z.string(),
    ordinal: z.number().int().nonnegative().safe(),
    occurrenceId: z.string().min(1).max(500),
  })
  .strict();
const historyCursorSchema = z
  .object({
    key: z.string(),
    snapshot: z.number().int().nonnegative().safe(),
    before: z.number().int().positive().safe(),
  })
  .strict()
  .refine((value) => value.before <= value.snapshot);
type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const nullable = (value: unknown) => (typeof value === 'string' ? value : null);
const timestamp = () => new Date().toISOString();
const fail = (code: string): never => {
  throw new Error(code);
};

export class CalendarRepository {
  private readonly sources: CalendarSourceReader;

  constructor(private readonly db: Database.Database) {
    this.sources = new CalendarSourceReader(db);
    db.function('aiy_calendar_day_start', { deterministic: true }, (date: unknown, timeZone: unknown) =>
      new Date(calendarDateStartEpoch(str(date), str(timeZone))).toISOString(),
    );
    db.function('aiy_calendar_local_date', { deterministic: true }, (value: unknown, timeZone: unknown) =>
      calendarLocalDate(str(value), str(timeZone)),
    );
  }

  query(raw: CalendarQueryInput) {
    const input = calendarQuerySchema.parse(raw);
    this.sources.clearResults();
    const read = () => {
      const categories = [...new Set(input.categories)].sort();
      const key = createHash('sha256')
        .update(
          JSON.stringify({
            version: 8,
            instanceId: this.db.prepare('SELECT instance_id FROM calendar_state WHERE id=1').pluck().get(),
            spaceId: this.librarySpaceId(),
            startDate: input.startDate,
            endDate: input.endDate,
            timeZone: input.timeZone,
            timeAxis: input.timeAxis,
            knownAt: input.knownAt ?? null,
            categories,
            includeInvalidated: input.includeInvalidated,
          }),
        )
        .digest('hex');
      const revision = this.stateRevision();
      let cursor: z.infer<typeof cursorSchema> | null = null;
      if (input.cursor) {
        try {
          cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
        } catch {
          fail('CALENDAR_CURSOR_INVALID');
        }
        if (cursor!.key !== key) fail('CALENDAR_CURSOR_INVALID');
        if (cursor!.revision !== revision) fail('CALENDAR_CURSOR_STALE');
      }
      const snapshot =
        cursor?.snapshot ?? Number(this.db.prepare('SELECT COALESCE(MAX(rowid),0) FROM change_events').pluck().get());
      const rows = readCalendarRows(this.db, { ...input, categories }, snapshot, input.limit, cursor);
      const hasMore = rows.length > input.limit;
      const visible = rows.slice(0, input.limit);
      this.sources.prefetch(
        visible.flatMap((row) => {
          const type = row.object_type ?? row.entity_type;
          const id = row.object_id ?? row.entity_id;
          return type !== null && id !== null ? [{ type, id }] : [];
        }),
      );
      const items = visible.map((row) => this.readItem(row, input));
      const last = visible.at(-1);
      return calendarQueryResultSchema.parse({
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  key,
                  snapshot,
                  revision,
                  at: last.sort_at,
                  ordinal: last.item_revision,
                  occurrenceId: last.occurrence_id,
                }),
              ).toString('base64url')
            : null,
        coverage: calendarCoverage(this.db, snapshot, items.length, input.knownAt),
      });
    };
    return this.db.inTransaction ? read() : this.db.transaction(read)();
  }

  summary(raw: CalendarSummaryQueryInput) {
    const input = calendarSummaryQuerySchema.parse(raw);
    const read = () => {
      const snapshot = Number(this.db.prepare('SELECT COALESCE(MAX(rowid),0) FROM change_events').pluck().get());
      const days = readCalendarDayCounts(this.db, input, snapshot);
      return calendarSummaryResultSchema.parse({
        days,
        timeAxis: input.timeAxis,
        snapshotEventRowid: snapshot,
        stateRevision: this.stateRevision(),
        coverage: calendarCoverage(
          this.db,
          snapshot,
          days.reduce((sum, day) => sum + day.total, 0),
          input.knownAt,
        ),
      });
    };
    return this.db.inTransaction ? read() : this.db.transaction(read)();
  }

  correctActivity(raw: CalendarActivityCorrectionInput): CalendarItem {
    const input = calendarActivityCorrectionSchema.parse(raw);
    this.sources.clearResults();
    return this.db
      .transaction(() => {
        if (!this.db.prepare('SELECT 1 FROM change_events WHERE id=?').get(input.eventId))
          fail('CALENDAR_EVENT_UNAVAILABLE');
        const current = this.db
          .prepare('SELECT revision FROM calendar_activity_overrides WHERE event_id=?')
          .get(input.eventId) as Row | undefined;
        if (Number(current?.revision ?? 0) !== input.expectedRevision) fail('CALENDAR_REVISION_CONFLICT');
        const revision = input.expectedRevision + 1;
        const recordedAt = timestamp();
        if (current) {
          const result = this.db
            .prepare(
              'UPDATE calendar_activity_overrides SET revision=?,note=?,display_date=?,invalidated=?,updated_at=? WHERE event_id=? AND revision=?',
            )
            .run(
              revision,
              input.note,
              input.displayDate,
              input.invalidated ? 1 : 0,
              recordedAt,
              input.eventId,
              input.expectedRevision,
            );
          if (result.changes !== 1) fail('CALENDAR_REVISION_CONFLICT');
        } else {
          this.db
            .prepare(
              'INSERT INTO calendar_activity_overrides(event_id,revision,note,display_date,invalidated,recorded_at,updated_at) VALUES(?,?,?,?,?,?,?)',
            )
            .run(
              input.eventId,
              revision,
              input.note,
              input.displayDate,
              input.invalidated ? 1 : 0,
              recordedAt,
              recordedAt,
            );
        }
        this.db
          .prepare(
            'INSERT INTO calendar_activity_override_revisions(event_id,revision,note,display_date,invalidated,recorded_at) VALUES(?,?,?,?,?,?)',
          )
          .run(input.eventId, revision, input.note, input.displayDate, input.invalidated ? 1 : 0, recordedAt);
        this.bumpRevision();
        return this.activityItem(input.eventId, 'UTC');
      })
      .immediate();
  }

  history(raw: CalendarHistoryInput) {
    const input = calendarHistoryInputSchema.parse(raw);
    const read = () => {
      const key = createHash('sha256')
        .update(
          JSON.stringify({
            version: 2,
            instanceId: this.db.prepare('SELECT instance_id FROM calendar_state WHERE id=1').pluck().get(),
            spaceId: this.librarySpaceId(),
            id: input.id,
            knownAt: input.knownAt ?? null,
          }),
        )
        .digest('hex');
      let cursor: z.infer<typeof historyCursorSchema> | null = null;
      if (input.cursor) {
        try {
          cursor = historyCursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
        } catch {
          fail('CALENDAR_CURSOR_INVALID');
        }
        if (cursor!.key !== key) fail('CALENDAR_CURSOR_INVALID');
      }
      const snapshot =
        cursor?.snapshot ??
        Number(
          this.db
            .prepare(
              `SELECT COALESCE(MAX(revision),0) FROM calendar_activity_override_revisions
              WHERE event_id=? ${input.knownAt ? 'AND recorded_at <= ?' : ''}`,
            )
            .pluck()
            .get(input.id, ...(input.knownAt ? [input.knownAt] : [])),
        );
      const rows = this.db
        .prepare(
          `SELECT revision,note,display_date,invalidated,recorded_at
          FROM calendar_activity_override_revisions
          WHERE event_id=? AND revision <= ? ${input.knownAt ? 'AND recorded_at <= ?' : ''}
            ${cursor ? 'AND revision < ?' : ''}
          ORDER BY revision DESC LIMIT ?`,
        )
        .all(
          input.id,
          snapshot,
          ...(input.knownAt ? [input.knownAt] : []),
          ...(cursor ? [cursor.before] : []),
          input.limit + 1,
        ) as Row[];
      const hasMore = rows.length > input.limit;
      const visible = rows.slice(0, input.limit);
      const last = visible.at(-1);
      return calendarHistoryResultSchema.parse({
        truncated: hasMore,
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(JSON.stringify({ key, snapshot, before: Number(last.revision) })).toString('base64url')
            : null,
        revisions: visible.map((row) => ({
          revision: Number(row.revision),
          recordedAt: row.recorded_at,
          note: str(row.note),
          displayDate: nullable(row.display_date),
          invalidated: Boolean(row.invalidated),
        })),
      });
    };
    return this.db.inTransaction ? read() : this.db.transaction(read)();
  }

  getPreferences() {
    const raw = this.db.prepare('SELECT preferences_json FROM calendar_preferences WHERE id=1').pluck().get();
    if (typeof raw === 'string') return calendarPreferencesSchema.parse(JSON.parse(raw));
    return calendarPreferencesSchema.parse({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      categories: ['content', 'organization', 'knowledge', 'ai', 'delivery', 'workspace', 'other'],
      showInvalidated: false,
      showUsage: false,
      usageMetric: 'calls',
      weekStartsOn: 1,
    });
  }

  savePreferences(raw: CalendarPreferencesInput) {
    const value = calendarPreferencesSchema.parse(raw);
    this.db
      .prepare(
        'INSERT INTO calendar_preferences(id,preferences_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET preferences_json=excluded.preferences_json',
      )
      .run(JSON.stringify(value));
    return value;
  }

  private activityItem(id: string, timeZone: string): CalendarItem {
    const row = this.db
      .prepare(
        `SELECT e.id,e.entity_type,e.entity_id,e.operation,e.occurred_at,${calendarCategorySql} category,
        f.recorded_at file_recorded_at,
        o.revision,o.note,o.display_date,o.invalidated,o.updated_at FROM change_events e
        LEFT JOIN calendar_activity_overrides o ON o.event_id=e.id
        LEFT JOIN calendar_file_event_times f ON f.event_id=e.id WHERE e.id=?`,
      )
      .get(id) as Row | undefined;
    const activity = row ?? fail('CALENDAR_EVENT_UNAVAILABLE');
    const originalRecordedAt = str(activity.file_recorded_at ?? activity.occurred_at);
    const ref = { type: str(activity.entity_type), id: str(activity.entity_id) };
    const source = this.sources.read(ref);
    const date = nullable(activity.display_date);
    const when: CalendarTime = date
      ? { kind: 'allDay', date, endDate: null }
      : { kind: 'timed', startAt: str(activity.occurred_at), endAt: null, timeZone };
    return calendarItemSchema.parse({
      id,
      category: activity.category,
      title: source.title,
      sourceType: source.type,
      changes: [{ entityType: ref.type, operation: str(activity.operation), count: 1 }],
      thumbnailAssetId: source.thumbnailAssetId,
      packSync: source.packSync,
      note: str(activity.note),
      operation: str(activity.operation),
      entity: { ...ref, available: source.available, navigateTo: source.navigateTo },
      when,
      recordedAt: originalRecordedAt,
      originalRecordedAt,
      updatedAt: activity.updated_at ?? originalRecordedAt,
      timeBasis: date ? 'declared' : activity.file_recorded_at ? 'observed' : 'recorded',
      revision: Number(activity.revision ?? 0),
      invalidated: Boolean(activity.invalidated),
      corrected: Number(activity.revision ?? 0) > 0,
      occurrenceId: JSON.stringify(['activity', id, Number(activity.revision ?? 0)]),
      displayWhen: when,
      historical: false,
    });
  }

  private readItem(row: CalendarReadRow, input: CalendarReadFilter): CalendarItem {
    const item = calendarActivityItemFromReadRow(row, input, this.sources);
    return calendarItemSchema.parse({
      ...item,
      historical: Boolean(input.knownAt) || item.historical,
      title: input.knownAt ? '' : item.title,
      sourceType: input.knownAt ? null : item.sourceType,
      thumbnailAssetId: input.knownAt ? null : item.thumbnailAssetId,
      occurrenceId: row.occurrence_id,
      operation: row.source === 'activity_correction' ? 'CORRECT' : item.operation,
      displayWhen:
        input.timeAxis === 'recorded'
          ? { kind: 'timed', startAt: row.sort_at, endAt: null, timeZone: input.timeZone }
          : item.when,
    });
  }

  private stateRevision() {
    return Number(this.db.prepare('SELECT revision FROM calendar_state WHERE id=1').pluck().get());
  }

  private librarySpaceId() {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_spaces'").get()) return null;
    return nullable(this.db.prepare('SELECT id FROM local_spaces WHERE singleton_key=1').pluck().get());
  }

  private bumpRevision() {
    this.db.prepare('UPDATE calendar_state SET revision=revision+1 WHERE id=1').run();
  }
}
