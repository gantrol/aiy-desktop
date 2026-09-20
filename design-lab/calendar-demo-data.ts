import { z } from 'zod';
import {
  calendarActivityCorrectionSchema,
  calendarHistoryInputSchema,
  calendarHistoryResultSchema,
  calendarItemSchema,
  calendarQueryResultSchema,
  calendarQuerySchema,
  calendarSummaryQuerySchema,
  calendarSummaryResultSchema,
  type CalendarApi,
  type CalendarHistoryResult,
  type CalendarItem,
  type CalendarTime,
} from '@/shared/contracts/calendar';
import { dateInTimeZone, shiftDate } from '@/renderer/features/calendar/calendarDates';

type Label = (zh: string, en: string) => string;
type DemoApi = Pick<CalendarApi, 'query' | 'summary' | 'correctActivity' | 'history'>;
const cursorSchema = z
  .object({ key: z.string(), offset: z.number().int().nonnegative(), version: z.number().int().nonnegative() })
  .strict();
const encodeCursor = (value: z.infer<typeof cursorSchema>) => btoa(JSON.stringify(value));

function cursorOffset(raw: string | undefined, key: string, version: number) {
  if (!raw) return 0;
  let cursor: z.infer<typeof cursorSchema>;
  try {
    cursor = cursorSchema.parse(JSON.parse(atob(raw)));
  } catch {
    throw new Error('CALENDAR_CURSOR_INVALID');
  }
  if (cursor.key !== key) throw new Error('CALENDAR_CURSOR_INVALID');
  if (cursor.version !== version) throw new Error('CALENDAR_CURSOR_STALE');
  return cursor.offset;
}

function dateRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}

function instant(date: string, hour: number) {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`).toISOString();
}

function eventDate(item: CalendarItem, timeAxis: 'effective' | 'recorded', timeZone: string) {
  if (timeAxis === 'recorded') return dateInTimeZone(item.updatedAt, timeZone);
  return item.when.kind === 'allDay' ? item.when.date : dateInTimeZone(item.when.startAt, timeZone);
}

function timed(startAt: string): CalendarTime {
  return { kind: 'timed', startAt, endAt: null, timeZone: 'Asia/Shanghai' };
}

function activity(input: {
  id: string;
  title: string;
  note: string;
  category: CalendarItem['category'];
  when: CalendarTime;
  recordedAt: string;
  operation: string;
  entity?: { type: string; id: string };
  count?: number;
}): CalendarItem {
  const entity = input.entity ?? { type: 'ARTICLE', id: 'rose' };
  return calendarItemSchema.parse({
    id: input.id,
    occurrenceId: JSON.stringify(['activity', input.id, 0]),
    displayWhen: input.when,
    historical: false,
    category: input.category,
    title: input.title,
    note: input.note,
    operation: input.operation,
    entity: { ...entity, available: true, navigateTo: entity },
    when: input.when,
    recordedAt: input.recordedAt,
    updatedAt: input.recordedAt,
    originalRecordedAt: input.recordedAt,
    timeBasis: 'recorded',
    activityCount: input.count ?? 1,
    activitySummary:
      (input.count ?? 1) > 1
        ? {
            object: entity,
            firstAt: input.recordedAt,
            lastAt: input.recordedAt,
            categories: [input.category],
          }
        : null,
    revision: 0,
    invalidated: false,
    corrected: false,
  });
}

export function createCalendarDemoApi(today: string, label: Label): DemoApi {
  const yesterday = shiftDate(today, -1);
  const twoDaysAgo = shiftDate(today, -2);
  const weekAgo = shiftDate(today, -7);
  const seed = [
    activity({
      id: 'activity-article',
      title: label('玫瑰教程', 'Rose tutorial'),
      note: label('整理了文章结构和配图。', 'Refined the article structure and imagery.'),
      category: 'content',
      when: timed(instant(today, 10)),
      recordedAt: instant(today, 10),
      operation: 'UPDATE',
      count: 4,
    }),
    activity({
      id: 'activity-image',
      title: label('封面图生成', 'Cover image generation'),
      note: label('生成并选用了新的封面图。', 'Generated and selected a new cover image.'),
      category: 'ai',
      when: timed(instant(today, 14)),
      recordedAt: instant(today, 14),
      operation: 'GENERATE',
      entity: { type: 'ARTICLE', id: 'rose' },
    }),
    activity({
      id: 'activity-organize',
      title: label('内容整理', 'Content organization'),
      note: label('调整了内容归档位置。', 'Reorganized the content library.'),
      category: 'organization',
      when: timed(instant(yesterday, 16)),
      recordedAt: instant(yesterday, 16),
      operation: 'MOVE',
    }),
    activity({
      id: 'activity-knowledge',
      title: label('知识条目更新', 'Knowledge entry update'),
      note: label('补充了相关术语。', 'Added related terminology.'),
      category: 'knowledge',
      when: { kind: 'allDay', date: twoDaysAgo, endDate: null },
      recordedAt: instant(twoDaysAgo, 11),
      operation: 'UPDATE',
    }),
    activity({
      id: 'activity-delivery',
      title: label('文章交付', 'Article delivery'),
      note: label('导出了文章版本。', 'Exported an article revision.'),
      category: 'delivery',
      when: timed(instant(weekAgo, 18)),
      recordedAt: instant(weekAgo, 18),
      operation: 'EXPORT',
    }),
  ];
  const items = new Map(seed.map((item) => [item.id, item]));
  const originalWhen = new Map(seed.map((item) => [item.id, item.when]));
  const revisions = new Map<string, CalendarHistoryResult['revisions']>();
  let version = seed.length;

  function assertSpace(spaceId: string) {
    if (spaceId !== 'calendar-demo') throw new Error('CALENDAR_SPACE_CHANGED');
  }

  function selected(input: z.infer<typeof calendarQuerySchema>) {
    return [...items.values()]
      .filter((item) => input.categories.includes(item.category))
      .filter((item) => input.includeInvalidated || !item.invalidated)
      .filter((item) => !input.knownAt || item.recordedAt <= input.knownAt)
      .filter((item) => {
        const date = eventDate(item, input.timeAxis, input.timeZone);
        return date >= input.startDate && date <= input.endDate;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  return {
    async query(raw, spaceId) {
      assertSpace(spaceId);
      const input = calendarQuerySchema.parse(raw);
      const { cursor, limit, ...scope } = input;
      const key = JSON.stringify(scope);
      const offset = cursorOffset(cursor, key, version);
      const all = selected(input);
      const page = all.slice(offset, offset + limit).map((item) => {
        const displayWhen: CalendarTime =
          input.timeAxis === 'recorded'
            ? { kind: 'timed', startAt: item.updatedAt, endAt: null, timeZone: input.timeZone }
            : item.when;
        return calendarItemSchema.parse({ ...item, displayWhen, historical: Boolean(input.knownAt) });
      });
      const hasMore = offset + page.length < all.length;
      return calendarQueryResultSchema.parse({
        items: page,
        hasMore,
        nextCursor: hasMore ? encodeCursor({ key, offset: offset + page.length, version }) : null,
        coverage: {
          source: 'change_events',
          completeness: 'partial',
          firstRecordedAt: seed.map((item) => item.recordedAt).sort()[0] ?? null,
          gaps: ['unrecorded_legacy_changes'],
          returnedCount: page.length,
          snapshotEventRowid: version,
        },
      });
    },

    async summary(raw, spaceId) {
      assertSpace(spaceId);
      const input = calendarSummaryQuerySchema.parse(raw);
      const query = calendarQuerySchema.parse({ ...input, limit: 500 });
      const all = selected(query);
      const days = dateRange(input.startDate, input.endDate).map((date) => {
        const count = all.filter((item) => eventDate(item, input.timeAxis, input.timeZone) === date).length;
        return { date, total: count };
      });
      return calendarSummaryResultSchema.parse({
        days,
        timeAxis: input.timeAxis,
        snapshotEventRowid: version,
        stateRevision: version,
        coverage: {
          source: 'change_events',
          completeness: 'partial',
          firstRecordedAt: seed.map((item) => item.recordedAt).sort()[0] ?? null,
          gaps: ['unrecorded_legacy_changes'],
          returnedCount: days.reduce((sum, day) => sum + day.total, 0),
          snapshotEventRowid: version,
        },
      });
    },

    async correctActivity(raw, spaceId) {
      assertSpace(spaceId);
      const input = calendarActivityCorrectionSchema.parse(raw);
      const current = items.get(input.eventId);
      if (!current) throw new Error('CALENDAR_EVENT_UNAVAILABLE');
      if (current.revision !== input.expectedRevision) throw new Error('CALENDAR_REVISION_CONFLICT');
      const recordedAt = new Date().toISOString();
      const when = input.displayDate
        ? ({ kind: 'allDay', date: input.displayDate, endDate: null } as const)
        : originalWhen.get(input.eventId)!;
      const revision = current.revision + 1;
      const next = calendarItemSchema.parse({
        ...current,
        occurrenceId: JSON.stringify(['activity', current.id, revision]),
        displayWhen: when,
        when,
        note: input.note,
        updatedAt: recordedAt,
        timeBasis: input.displayDate ? 'declared' : current.timeBasis,
        revision,
        invalidated: input.invalidated,
        corrected: true,
      });
      items.set(next.id, next);
      revisions.set(next.id, [
        {
          revision,
          recordedAt,
          note: input.note,
          displayDate: input.displayDate,
          invalidated: input.invalidated,
        },
        ...(revisions.get(next.id) ?? []),
      ]);
      version++;
      return next;
    },

    async history(raw, spaceId) {
      assertSpace(spaceId);
      const input = calendarHistoryInputSchema.parse(raw);
      const key = JSON.stringify({ id: input.id, knownAt: input.knownAt ?? null });
      const offset = cursorOffset(input.cursor, key, version);
      const all = (revisions.get(input.id) ?? []).filter(
        (revision) => !input.knownAt || revision.recordedAt <= input.knownAt,
      );
      const page = all.slice(offset, offset + input.limit);
      const hasMore = offset + page.length < all.length;
      return calendarHistoryResultSchema.parse({
        revisions: page,
        truncated: hasMore,
        hasMore,
        nextCursor: hasMore ? encodeCursor({ key, offset: offset + page.length, version }) : null,
      });
    },
  };
}
