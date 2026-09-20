import { z } from 'zod';
import { calendarDateSchema, calendarEntityRefSchema, calendarTimeZoneSchema } from '@/shared/contracts/calendar';

export const calendarUsageSourceValues = [
  'IMAGE_GENERATION',
  'ASSISTANT',
  'AGENT_CHAT',
  'VIDEO_DOCUMENT_GENERATION',
  'VIDEO_TRANSLATION',
  'LOCAL_TRANSCRIPTION',
  'ARTICLE_CHECK',
] as const;
const source = z.enum(calendarUsageSourceValues);
const model = z.string().trim().min(1).max(500).nullable();
const snapshot = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]+$/);
const queryFields = {
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  timeZone: calendarTimeZoneSchema,
  sources: z.array(source).min(1).max(calendarUsageSourceValues.length).optional(),
  /** null selects an unknown model; absence includes every model. */
  model: model.optional(),
  modelAttribution: z.enum(['REQUESTED', 'OBSERVED']).optional(),
  /** Exact scope in the source record, which may have been explicitly rehomed. */
  target: calendarEntityRefSchema.nullable().optional(),
  /** Optional database snapshot returned by usage(), including across date drill-down. */
  snapshot: snapshot.optional(),
};
const validRange = (value: { startDate: string; endDate: string }) =>
  value.startDate <= value.endDate &&
  Date.parse(value.endDate + 'T00:00:00Z') - Date.parse(value.startDate + 'T00:00:00Z') < 366 * 86_400_000;
const rangeMessage = 'Calendar usage range must be ordered and contain at most 366 dates';

export const calendarUsageQuerySchema = z
  .object({
    ...queryFields,
    limitPerSource: z.number().int().min(1).max(10_000).optional(),
  })
  .strict()
  .refine(validRange, rangeMessage);
export const calendarUsageRunsQuerySchema = z
  .object({
    ...queryFields,
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .refine(validRange, rangeMessage);
export type CalendarUsageQuery = z.infer<typeof calendarUsageQuerySchema>;
export type CalendarUsageRunsQuery = z.infer<typeof calendarUsageRunsQuerySchema>;
export type CalendarUsageSource = (typeof calendarUsageSourceValues)[number];

const count = z.number().int().nonnegative().safe();
const token = count.nullable();
const tokenFields = {
  /** Each sum covers only recorded values. null means no values, not a measured zero. */
  knownInputTokens: token,
  /** A subset of input tokens; do not add again. */
  knownCachedInputTokens: token,
  knownOutputTokens: token,
  /** A subset of output tokens; do not add again. */
  knownReasoningOutputTokens: token,
  knownTotalTokens: token,
};
export const calendarUsageTotalsSchema = z
  .object({
    /** Unique local runs, including not-started records. Not a provider-request count. */
    runCount: count,
    failedRunCount: count,
    activeRunCount: count,
    notStartedRunCount: count,
    /** Runs with at least one trustworthy persisted token value. */
    usageKnownRunCount: count,
    /** Includes unmetered local work; never implies zero consumption. */
    usageMissingRunCount: count,
    /** Known runs with incomplete capture, including failed runs with consumption. */
    usagePartialRunCount: count,
    ...tokenFields,
  })
  .strict();
export type CalendarUsageTotals = z.infer<typeof calendarUsageTotalsSchema>;

const daySchema = calendarUsageTotalsSchema.extend({ date: calendarDateSchema }).strict();
const modelFields = {
  source,
  /** May be a configured route key; not proof of the model that ran. */
  requestedModel: model,
  /** Only an independently persisted provider response observation. */
  observedModel: model,
};
const modelSchema = calendarUsageTotalsSchema.extend(modelFields).strict();
const groupSchema = calendarUsageTotalsSchema
  .extend({ ...modelFields, date: calendarDateSchema, target: calendarEntityRefSchema.nullable() })
  .strict();
const targetSchema = calendarUsageTotalsSchema
  .extend({
    /** The source record's scope, not proof of historical ownership or adopted output. */
    target: calendarEntityRefSchema.nullable(),
    title: z.string().max(300),
    titleBasis: z.enum(['CURRENT', 'UNAVAILABLE']),
    available: z.boolean(),
    /** Current navigation is separate from the source's recorded scope. */
    navigateTo: calendarEntityRefSchema.nullable(),
  })
  .strict();
export type CalendarUsageDay = z.infer<typeof daySchema>;
export type CalendarUsageModel = z.infer<typeof modelSchema>;
export type CalendarUsageGroup = z.infer<typeof groupSchema>;
export type CalendarUsageTarget = z.infer<typeof targetSchema>;

const coverageNote = z.enum([
  'SOURCE_TABLE_MISSING',
  'SOURCE_COLUMNS_MISSING',
  'TOKENS_NOT_STORED',
  'THREAD_TOTALS_NOT_ATTRIBUTABLE',
  'MODEL_NOT_RECORDED',
  'MODEL_OBSERVATION_UNVERIFIED',
  'REQUESTED_ROUTE_ONLY',
  'MULTI_STAGE_SUBTOTAL',
  'LOCAL_COMPUTE_ONLY',
  'MISSING_START_TIME_NOT_INCLUDED',
  'INVALID_TOKEN_VALUES',
  'INVALID_START_TIME',
  'INVALID_FINISH_TIME',
  'TOKEN_SUM_OVERFLOW',
  'TARGET_NOT_RECORDED',
  'TARGET_METADATA_UNAVAILABLE',
]);
export type CalendarUsageCoverageNote = z.infer<typeof coverageNote>;
const sourceCoverageSchema = z
  .object({
    source,
    available: z.boolean(),
    includedRunCount: count,
    /** A source cap makes counts/sums partial. Pagination alone does not. */
    truncated: z.boolean(),
    notes: z.array(coverageNote).max(coverageNote.options.length),
  })
  .strict();
export type CalendarUsageSourceCoverage = z.infer<typeof sourceCoverageSchema>;
const coverageSchema = z
  .object({
    scope: z.literal('LOCAL_LIBRARY_RUNS'),
    tokenSemantics: z.literal('KNOWN_SUBTOTAL'),
    billing: z.literal('NOT_AVAILABLE'),
    externalSessions: z.literal('NOT_READ'),
    historicalUnobservedChats: z.literal('NOT_INCLUDED'),
    sources: z.array(sourceCoverageSchema).max(calendarUsageSourceValues.length),
  })
  .strict();
const resultFields = {
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  timeZone: calendarTimeZoneSchema,
  /** Runs belong to AIY's recorded start day; cross-midnight tokens are not split. */
  attribution: z.literal('RUN_START'),
  snapshot,
};
export const calendarUsageResultSchema = z
  .object({
    ...resultFields,
    totals: calendarUsageTotalsSchema,
    /** Blank dates mean no local records within this scope, not zero consumption. */
    days: z.array(daySchema).max(366),
    models: z.array(modelSchema).max(calendarUsageSourceValues.length * 10_000),
    /** Same-run cross-tabulation; never join the independent day/model aggregates. */
    groups: z.array(groupSchema).max(2000),
    targets: z.array(targetSchema).max(500),
    /** Display-group limits never reduce totals/days/models. */
    groupsTruncated: z.boolean(),
    targetsTruncated: z.boolean(),
    coverage: coverageSchema.extend({ limitPerSource: z.number().int().min(1).max(10_000) }).strict(),
    truncated: z.boolean(),
  })
  .strict();
export type CalendarUsageResult = z.infer<typeof calendarUsageResultSchema>;

const runSchema = z
  .object({
    ...modelFields,
    runId: z.string().min(1).max(200),
    date: calendarDateSchema,
    startedAt: z.string().datetime(),
    /** Source confirmation time; recovery may record interruption at restart. */
    finishedAt: z.string().datetime().nullable(),
    status: z.string().min(1).max(100),
    target: calendarEntityRefSchema.nullable(),
    targetBasis: z.enum(['RUN_SCOPE', 'PROMPT_VERSION_SCOPE', 'UNASSIGNED']),
    /** Exact original record; existence does not imply a standalone renderer route. */
    originalRun: calendarEntityRefSchema,
    ...tokenFields,
    usageState: z.enum(['KNOWN', 'PARTIAL', 'MISSING']),
    notes: z.array(coverageNote).max(coverageNote.options.length),
  })
  .strict();
export type CalendarUsageRun = z.infer<typeof runSchema>;
export const calendarUsageRunsResultSchema = z
  .object({
    ...resultFields,
    runs: z.array(runSchema).max(200),
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).max(2000).nullable(),
    coverage: coverageSchema,
  })
  .strict();
export type CalendarUsageRunsResult = z.infer<typeof calendarUsageRunsResultSchema>;
