import { z } from 'zod';
import { packSyncSummarySchema } from '@/shared/pack-sync';

export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number(value.slice(0, 4)) >= 1000 &&
      Number(value.slice(0, 4)) <= 9998 &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, 'Invalid calendar date');
export const calendarTimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid time zone');
const instant = z
  .string()
  .datetime({ offset: true })
  .refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= 1000 && year <= 9998;
  }, 'Unsupported calendar year')
  .transform((value) => new Date(value).toISOString());
const id = z.string().min(1).max(200);
export const calendarCategorySchema = z.enum([
  'content',
  'organization',
  'knowledge',
  'ai',
  'delivery',
  'workspace',
  'other',
]);
export const calendarTimeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('allDay'),
      date: calendarDateSchema,
      endDate: calendarDateSchema.nullable().default(null),
    })
    .strict()
    .refine((value) => value.endDate === null || value.endDate >= value.date, 'End date precedes start date'),
  z
    .object({
      kind: z.literal('timed'),
      startAt: instant,
      endAt: instant.nullable().default(null),
      timeZone: calendarTimeZoneSchema,
    })
    .strict()
    .refine((value) => value.endAt === null || value.endAt >= value.startAt, 'End time precedes start time'),
]);
export const calendarEntityRefSchema = z.object({ type: z.string().min(1).max(100), id }).strict();
export const calendarRangeSchema = z
  .object({ startDate: calendarDateSchema, endDate: calendarDateSchema, timeZone: calendarTimeZoneSchema })
  .strict()
  .refine(
    (value) =>
      value.endDate >= value.startDate && Date.parse(value.endDate) - Date.parse(value.startDate) < 366 * 86400000,
    'Calendar range must contain between 1 and 366 dates',
  );
export const calendarQuerySchema = z
  .object({
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    timeZone: calendarTimeZoneSchema,
    categories: z
      .array(calendarCategorySchema)
      .max(7)
      .default([...calendarCategorySchema.options]),
    includeInvalidated: z.boolean().default(false),
    timeAxis: z.enum(['effective', 'recorded']).default('effective'),
    knownAt: instant.optional(),
    limit: z.number().int().min(1).max(500).default(200),
    cursor: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      calendarRangeSchema.safeParse({ startDate: value.startDate, endDate: value.endDate, timeZone: value.timeZone })
        .success,
    'Calendar range must contain between 1 and 366 dates',
  );

export const calendarActivityCorrectionSchema = z
  .object({
    eventId: id,
    expectedRevision: z.number().int().nonnegative(),
    note: z.string().trim().min(1).max(4000),
    displayDate: calendarDateSchema.nullable(),
    invalidated: z.boolean(),
  })
  .strict();
export const calendarItemSchema = z
  .object({
    id,
    occurrenceId: z.string().min(1).max(500),
    displayWhen: calendarTimeSchema,
    historical: z.boolean(),
    category: calendarCategorySchema,
    title: z.string().max(300),
    sourceType: z.string().min(1).max(100).nullable().default(null),
    changes: z
      .array(
        z
          .object({
            entityType: z.string().min(1).max(100),
            operation: z.string().min(1).max(100),
            count: z.number().int().positive().safe(),
          })
          .strict(),
      )
      .default([]),
    thumbnailAssetId: id.nullable().default(null),
    packSync: packSyncSummarySchema.nullable().default(null),
    note: z.string().max(4000),
    operation: z.string().nullable(),
    entity: calendarEntityRefSchema
      .extend({ available: z.boolean(), navigateTo: calendarEntityRefSchema.nullable().optional() })
      .nullable(),
    when: calendarTimeSchema,
    recordedAt: instant,
    updatedAt: instant,
    originalRecordedAt: instant.nullable(),
    timeBasis: z.enum(['recorded', 'observed', 'declared']),
    activityCount: z.number().int().positive().default(1),
    activitySummary: z
      .object({
        object: calendarEntityRefSchema,
        firstAt: instant.nullable(),
        lastAt: instant.nullable(),
        categories: z.array(calendarCategorySchema),
      })
      .strict()
      .nullable()
      .default(null),
    revision: z.number().int().nonnegative(),
    invalidated: z.boolean(),
    corrected: z.boolean(),
  })
  .strict();
export const calendarCoverageGapSchema = z.enum([
  'activity_time_is_recorded_time',
  'unrecorded_legacy_changes',
  'petal_visibility_not_recorded',
  'job_transitions_not_recorded',
  'external_activity_not_linked',
]);
export const calendarQueryResultSchema = z
  .object({
    items: z.array(calendarItemSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    coverage: z
      .object({
        source: z.literal('change_events'),
        completeness: z.literal('partial'),
        firstRecordedAt: z.string().nullable(),
        gaps: z.array(calendarCoverageGapSchema),
        returnedCount: z.number().int().nonnegative(),
        snapshotEventRowid: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export const calendarSummaryQuerySchema = z
  .object({
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    timeZone: calendarTimeZoneSchema,
    categories: calendarQuerySchema.shape.categories,
    includeInvalidated: calendarQuerySchema.shape.includeInvalidated,
    timeAxis: calendarQuerySchema.shape.timeAxis,
    knownAt: calendarQuerySchema.shape.knownAt,
  })
  .strict()
  .refine(
    (value) =>
      calendarRangeSchema.safeParse({
        startDate: value.startDate,
        endDate: value.endDate,
        timeZone: value.timeZone,
      }).success,
    'Calendar range must contain between 1 and 366 dates',
  );
export const calendarSummaryResultSchema = z
  .object({
    days: z
      .array(
        z
          .object({
            date: calendarDateSchema,
            total: z.number().int().nonnegative().safe(),
          })
          .strict(),
      )
      .max(366),
    timeAxis: z.enum(['effective', 'recorded']),
    snapshotEventRowid: z.number().int().nonnegative(),
    stateRevision: z.number().int().nonnegative(),
    coverage: calendarQueryResultSchema.shape.coverage,
  })
  .strict();
export const calendarHistoryInputSchema = z
  .object({
    id,
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().min(1).max(2000).optional(),
    knownAt: instant.optional(),
  })
  .strict();
export const calendarRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    recordedAt: instant,
    note: z.string(),
    displayDate: calendarDateSchema.nullable(),
    invalidated: z.boolean(),
  })
  .strict();
export const calendarHistoryResultSchema = z
  .object({
    revisions: z.array(calendarRevisionSchema),
    truncated: z.boolean(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const calendarPreferencesSchema = z
  .object({
    timeZone: calendarTimeZoneSchema,
    categories: z.array(calendarCategorySchema).max(7),
    kinds: z.array(z.string().max(20)).max(3).optional(),
    showInvalidated: z.boolean(),
    timeAxis: z.enum(['effective', 'recorded']).default('effective'),
    view: z.enum(['month', 'agenda', 'week']).optional(),
    showUsage: z.boolean().default(false),
    usageMetric: z.enum(['calls', 'tokens', 'cost']).default('calls'),
    usageSource: z
      .enum([
        'all',
        'IMAGE_GENERATION',
        'ASSISTANT',
        'AGENT_CHAT',
        'VIDEO_DOCUMENT_GENERATION',
        'VIDEO_TRANSLATION',
        'LOCAL_TRANSCRIPTION',
        'ARTICLE_CHECK',
      ])
      .default('all'),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  })
  .strict()
  .transform(({ kinds: _legacyKinds, view: _legacyView, ...preferences }) => preferences);

export type CalendarCategory = z.infer<typeof calendarCategorySchema>;
export type CalendarTime = z.infer<typeof calendarTimeSchema>;
export type CalendarEntityRef = z.infer<typeof calendarEntityRefSchema>;
export type CalendarRange = z.infer<typeof calendarRangeSchema>;
export type CalendarQueryInput = z.input<typeof calendarQuerySchema>;
export type CalendarQueryResult = z.infer<typeof calendarQueryResultSchema>;
export type CalendarSummaryQueryInput = z.input<typeof calendarSummaryQuerySchema>;
export type CalendarSummaryResult = z.infer<typeof calendarSummaryResultSchema>;
export type CalendarDaySummary = CalendarSummaryResult['days'][number];
export type CalendarItem = z.infer<typeof calendarItemSchema>;
export type CalendarActivityCorrectionInput = z.input<typeof calendarActivityCorrectionSchema>;
export type CalendarHistoryInput = z.input<typeof calendarHistoryInputSchema>;
export type CalendarHistoryResult = z.infer<typeof calendarHistoryResultSchema>;
export type CalendarPreferences = z.infer<typeof calendarPreferencesSchema>;
export type CalendarPreferencesInput = z.input<typeof calendarPreferencesSchema>;

export interface CalendarApi {
  listViews(spaceId: string): Promise<import('@/shared/calendar-views').CalendarView[]>;
  saveView(
    input: import('@/shared/calendar-views').CalendarViewSaveInput,
    spaceId: string,
  ): Promise<import('@/shared/calendar-views').CalendarView>;
  deleteView(
    input: import('@/shared/calendar-views').CalendarViewDeleteInput,
    spaceId: string,
  ): Promise<{ deleted: true }>;
  query(input: CalendarQueryInput, spaceId: string): Promise<CalendarQueryResult>;
  summary(input: CalendarSummaryQueryInput, spaceId: string): Promise<CalendarSummaryResult>;
  correctActivity(input: CalendarActivityCorrectionInput, spaceId: string): Promise<CalendarItem>;
  history(input: CalendarHistoryInput, spaceId: string): Promise<CalendarHistoryResult>;
  getPreferences(spaceId: string): Promise<CalendarPreferences>;
  savePreferences(input: CalendarPreferencesInput, spaceId: string): Promise<CalendarPreferences>;
  usage(
    input: import('@/shared/calendar-usage').CalendarUsageQuery,
    spaceId: string,
  ): Promise<import('@/shared/calendar-usage').CalendarUsageResult>;
  usageRuns(
    input: import('@/shared/calendar-usage').CalendarUsageRunsQuery,
    spaceId: string,
  ): Promise<import('@/shared/calendar-usage').CalendarUsageRunsResult>;
}
