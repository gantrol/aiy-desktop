import { z } from 'zod';

const nonNegativeIntegerSchema = z.number().int().nonnegative().safe();
const positiveIntegerSchema = z.number().int().positive().safe();
const nonNegativeNumberSchema = z.number().finite().nonnegative();
const positiveNumberSchema = z.number().finite().positive();
const percentageSchema = z.number().finite().min(0);
const nullableMoneySchema = nonNegativeNumberSchema.nullable();

export const codexUsageRangeSchema = z.enum([
  'TODAY',
  'LAST_24_HOURS',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'ALL',
  'CUSTOM',
]);

export const codexUsageDateRangeSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .strict()
  .refine((range) => range.from <= range.to, 'The start date must not be after the end date');

const customRangeMessage = 'A custom Codex usage range requires explicit calendar dates';

function customRangeIsConsistent(value: {
  range: z.infer<typeof codexUsageRangeSchema>;
  dateRange: z.infer<typeof codexUsageDateRangeSchema> | null;
}) {
  return (value.range === 'CUSTOM') === (value.dateRange !== null);
}

export const codexUsageGranularitySchema = z.enum(['AUTO', 'HOUR', 'SIX_HOURS', 'DAY', 'WEEK']);
export const codexUsageResolvedGranularitySchema = z.enum(['HOUR', 'SIX_HOURS', 'DAY', 'WEEK']);

export const codexUsageTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA time zone');

export const codexUsageServiceTierSchema = z.enum(['STANDARD', 'FAST', 'UNKNOWN']);
export const codexUsageQuotaKindSchema = z.enum(['MAIN', 'SEPARATE', 'UNKNOWN']);
export const codexUsageObservedServiceTierSchema = z.enum(['STANDARD', 'FAST']);
export const codexUsageQuotaYieldAttributionSchema = z.enum(['OVERALL', 'MODEL_TIER']);
export const codexUsageQuotaYieldServiceTierSchema = z.enum(['ALL', 'STANDARD', 'FAST']);
export const codexUsageQuotaWindowKindSchema = z.enum(['PRIMARY', 'SECONDARY']);
export const codexUsageQuotaResetObservationKindSchema = z.enum([
  'RESET_SCHEDULE_CHANGED',
  'WINDOW_CHANGED',
  'USED_PERCENT_DECREASE_CONFIRMED',
  'QUOTA_RELEASED',
  'STALE_SNAPSHOT',
  'STREAM_CHANGED',
  'MANUAL_RESET_CONFIRMED',
  'WINDOW_ROLLOVER_CONFIRMED',
]);

export const codexUsageScanInputSchema = z
  .object({
    range: codexUsageRangeSchema,
    dateRange: codexUsageDateRangeSchema.nullable().default(null),
    timeZone: codexUsageTimeZoneSchema.default('UTC'),
    granularity: codexUsageGranularitySchema.default('AUTO'),
    detailedStatistics: z.boolean().default(false),
  })
  .strict()
  .refine(customRangeIsConsistent, {
    message: customRangeMessage,
    path: ['dateRange'],
  });

export const codexUsageQuotaYieldSampleSchema = z
  .object({
    attribution: codexUsageQuotaYieldAttributionSchema.default('MODEL_TIER'),
    planType: z.string().trim().min(1).max(200),
    limitId: z.string().trim().min(1).max(512).nullable().default(null),
    quotaKind: codexUsageQuotaKindSchema.default('MAIN'),
    windowKind: codexUsageQuotaWindowKindSchema.default('PRIMARY'),
    windowDurationMins: nonNegativeNumberSchema.nullable().default(null),
    model: z.string().trim().min(1).max(200),
    serviceTier: codexUsageQuotaYieldServiceTierSchema,
    from: z.string().datetime(),
    to: z.string().datetime(),
    resetsAt: nonNegativeIntegerSchema.nullable(),
    quotaPercentConsumed: positiveNumberSchema,
    requestCount: nonNegativeIntegerSchema.default(0),
    inputTokens: nonNegativeIntegerSchema.default(0),
    cachedInputTokens: nonNegativeIntegerSchema.default(0),
    cacheWriteInputTokens: nonNegativeIntegerSchema.default(0),
    outputTokens: nonNegativeIntegerSchema.default(0),
    reasoningOutputTokens: nonNegativeIntegerSchema.default(0),
    totalTokens: nonNegativeIntegerSchema,
    tokensPerOnePercent: nonNegativeNumberSchema,
    quotaPercentPerMillionTokens: nonNegativeNumberSchema.default(0),
    codexCredits: nullableMoneySchema.default(null),
    codexCreditsPerOnePercent: nullableMoneySchema.default(null),
  })
  .strict();

export const codexUsageQuotaYieldEstimateSchema = z
  .object({
    attribution: codexUsageQuotaYieldAttributionSchema.default('MODEL_TIER'),
    planType: z.string().trim().min(1).max(200),
    limitId: z.string().trim().min(1).max(512).nullable().default(null),
    quotaKind: codexUsageQuotaKindSchema.default('MAIN'),
    windowKind: codexUsageQuotaWindowKindSchema.default('PRIMARY'),
    windowDurationMins: nonNegativeNumberSchema.nullable().default(null),
    model: z.string().trim().min(1).max(200),
    serviceTier: codexUsageQuotaYieldServiceTierSchema,
    tokensPerOnePercent: nonNegativeNumberSchema,
    medianTokensPerOnePercent: nonNegativeNumberSchema,
    medianNonCachedTokensPerOnePercent: nonNegativeNumberSchema.default(0),
    percentile25TokensPerOnePercent: nonNegativeNumberSchema.default(0),
    percentile75TokensPerOnePercent: nonNegativeNumberSchema.default(0),
    minimumTokensPerOnePercent: nonNegativeNumberSchema,
    maximumTokensPerOnePercent: nonNegativeNumberSchema,
    quotaPercentPerMillionTokens: nonNegativeNumberSchema.default(0),
    codexCredits: nullableMoneySchema.default(null),
    codexCreditsPerOnePercent: nullableMoneySchema.default(null),
    totalTokens: nonNegativeIntegerSchema,
    requestCount: nonNegativeIntegerSchema.default(0),
    inputTokens: nonNegativeIntegerSchema.default(0),
    cachedInputTokens: nonNegativeIntegerSchema.default(0),
    cacheWriteInputTokens: nonNegativeIntegerSchema.default(0),
    outputTokens: nonNegativeIntegerSchema.default(0),
    reasoningOutputTokens: nonNegativeIntegerSchema.default(0),
    cachedInputPercent: nonNegativeNumberSchema.default(0),
    quotaPercentObserved: positiveNumberSchema,
    sampleCount: nonNegativeIntegerSchema,
    firstAt: z.string().datetime(),
    lastAt: z.string().datetime(),
  })
  .strict();

export const codexUsageQuotaYieldTimeSliceSchema = z
  .object({
    attribution: codexUsageQuotaYieldAttributionSchema.default('MODEL_TIER'),
    granularity: codexUsageResolvedGranularitySchema,
    timeZone: codexUsageTimeZoneSchema,
    bucketKey: z.string().min(1).max(300),
    label: z.string().min(1).max(300),
    observedFrom: z.string().datetime(),
    observedTo: z.string().datetime(),
    planType: z.string().trim().min(1).max(200),
    limitId: z.string().trim().min(1).max(512).nullable(),
    quotaKind: codexUsageQuotaKindSchema,
    windowKind: codexUsageQuotaWindowKindSchema,
    windowDurationMins: nonNegativeNumberSchema.nullable(),
    model: z.string().trim().min(1).max(200),
    serviceTier: codexUsageQuotaYieldServiceTierSchema,
    tokensPerOnePercent: nonNegativeNumberSchema,
    medianTokensPerOnePercent: nonNegativeNumberSchema,
    medianNonCachedTokensPerOnePercent: nonNegativeNumberSchema.default(0),
    percentile25TokensPerOnePercent: nonNegativeNumberSchema,
    percentile75TokensPerOnePercent: nonNegativeNumberSchema,
    quotaPercentPerMillionTokens: nonNegativeNumberSchema,
    codexCreditsPerOnePercent: nullableMoneySchema,
    totalTokens: nonNegativeIntegerSchema,
    inputTokens: nonNegativeIntegerSchema.default(0),
    cachedInputTokens: nonNegativeIntegerSchema.default(0),
    outputTokens: nonNegativeIntegerSchema.default(0),
    reasoningOutputTokens: nonNegativeIntegerSchema.default(0),
    cachedInputPercent: nonNegativeNumberSchema.default(0),
    quotaPercentObserved: positiveNumberSchema,
    sampleCount: nonNegativeIntegerSchema,
    requestCount: nonNegativeIntegerSchema,
    changeFromPreviousPercent: z.number().finite().nullable(),
  })
  .strict();

export const codexUsageQuotaResetObservationSchema = z
  .object({
    kind: codexUsageQuotaResetObservationKindSchema,
    observedAt: z.string().datetime(),
    planType: z.string().trim().min(1).max(200).nullable(),
    limitId: z.string().trim().min(1).max(512).nullable().default(null),
    quotaKind: codexUsageQuotaKindSchema.default('MAIN'),
    windowKind: codexUsageQuotaWindowKindSchema.default('PRIMARY'),
    windowDurationMins: nonNegativeNumberSchema.nullable().default(null),
    previousUsedPercent: nonNegativeNumberSchema,
    currentUsedPercent: nonNegativeNumberSchema,
    previousResetsAt: nonNegativeIntegerSchema.nullable(),
    currentResetsAt: nonNegativeIntegerSchema.nullable(),
  })
  .strict();

export const codexUsageQuotaCycleModelShareSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    serviceTier: codexUsageServiceTierSchema.default('UNKNOWN'),
    inferredServiceTierTokens: nonNegativeIntegerSchema.default(0),
    totalTokens: nonNegativeIntegerSchema,
    tokenPercent: percentageSchema,
    requestCount: nonNegativeIntegerSchema,
  })
  .strict();

export const codexUsageQuotaCycleSchema = z
  .object({
    cycleKey: z.string().min(1).max(1_000),
    planType: z.string().trim().min(1).max(200),
    limitId: z.string().trim().min(1).max(512).nullable(),
    quotaKind: codexUsageQuotaKindSchema,
    windowKind: codexUsageQuotaWindowKindSchema,
    windowDurationMins: positiveNumberSchema,
    startsAt: z.string().datetime(),
    resetsAt: nonNegativeIntegerSchema,
    observedFrom: z.string().datetime(),
    observedTo: z.string().datetime(),
    baselineUsedPercent: percentageSchema,
    maximumUsedPercent: percentageSchema,
    quotaPercentConsumed: positiveNumberSchema,
    requestCount: nonNegativeIntegerSchema,
    inputTokens: nonNegativeIntegerSchema,
    cachedInputTokens: nonNegativeIntegerSchema,
    cacheWriteInputTokens: nonNegativeIntegerSchema,
    outputTokens: nonNegativeIntegerSchema,
    reasoningOutputTokens: nonNegativeIntegerSchema,
    totalTokens: nonNegativeIntegerSchema,
    standardEquivalentTokens: nonNegativeNumberSchema.nullable().default(null),
    tokensPerOnePercent: nonNegativeNumberSchema,
    nonCachedTokensPerOnePercent: nonNegativeNumberSchema,
    standardEquivalentTokensPerOnePercent: nonNegativeNumberSchema.nullable().default(null),
    standardEquivalentNonCachedTokensPerOnePercent: nonNegativeNumberSchema.nullable().default(null),
    cachedInputPercent: percentageSchema,
    modelShares: z.array(codexUsageQuotaCycleModelShareSchema).max(200),
  })
  .strict();

export const codexUsageQuotaYieldAnalysisSchema = z
  .object({
    definition: z.literal('OBSERVED_TOKENS_PER_SUBSCRIPTION_QUOTA_PERCENT'),
    calculationBasis: z.enum(['RESET_CYCLE', 'OBSERVATION_SEGMENT']).default('OBSERVATION_SEGMENT'),
    algorithmVersion: nonNegativeIntegerSchema.default(7),
    timeZone: codexUsageTimeZoneSchema.default('UTC'),
    defaultGranularity: codexUsageResolvedGranularitySchema.default('DAY'),
    storedFrom: z.string().datetime().nullable(),
    storedTo: z.string().datetime().nullable(),
    storedSessionCount: nonNegativeIntegerSchema,
    sourceEventCount: nonNegativeIntegerSchema,
    resetCount: nonNegativeIntegerSchema,
    confirmedResetCount: nonNegativeIntegerSchema.default(0),
    quotaReleasedCount: nonNegativeIntegerSchema.default(0),
    staleSnapshotCount: nonNegativeIntegerSchema.default(0),
    streamChangedCount: nonNegativeIntegerSchema.default(0),
    forecastChangedCount: nonNegativeIntegerSchema.default(0),
    eligibleSampleCount: nonNegativeIntegerSchema.default(0),
    samplesTruncated: z.boolean().default(false),
    unattributedQuotaPercent: nonNegativeNumberSchema.default(0),
    discardedIncompleteIntervals: nonNegativeIntegerSchema,
    discardedMixedModelIntervals: nonNegativeIntegerSchema,
    discardedMixedTierIntervals: nonNegativeIntegerSchema,
    discardedUnknownTierIntervals: nonNegativeIntegerSchema,
    discardedUnknownPlanIntervals: nonNegativeIntegerSchema,
    discardedUnknownQuotaIntervals: nonNegativeIntegerSchema,
    discardedStaleSnapshotIntervals: nonNegativeIntegerSchema,
    discardedWarmupIntervals: nonNegativeIntegerSchema.default(0),
    discardedNonConsecutiveIntervals: nonNegativeIntegerSchema.default(0),
    resetObservations: z.array(codexUsageQuotaResetObservationSchema).max(1_000),
    cycles: z.array(codexUsageQuotaCycleSchema).max(2_000).default([]),
    samples: z.array(codexUsageQuotaYieldSampleSchema).max(25_000),
    estimates: z.array(codexUsageQuotaYieldEstimateSchema).max(5_000),
    timeSlices: z.array(codexUsageQuotaYieldTimeSliceSchema).max(20_000).default([]),
  })
  .strict();

export const codexUsageTokenTotalsSchema = z
  .object({
    inputTokens: nonNegativeIntegerSchema,
    cachedInputTokens: nonNegativeIntegerSchema,
    cacheWriteInputTokens: nonNegativeIntegerSchema,
    outputTokens: nonNegativeIntegerSchema,
    reasoningOutputTokens: nonNegativeIntegerSchema,
    totalTokens: nonNegativeIntegerSchema,
    apiEquivalentUsd: nullableMoneySchema,
    apiCacheSavingsUsd: nullableMoneySchema,
    codexCredits: nullableMoneySchema,
    codexCreditCacheSavings: nullableMoneySchema.default(null),
    apiPricedTokens: nonNegativeIntegerSchema,
    creditPricedTokens: nonNegativeIntegerSchema,
  })
  .strict();

export const codexUsageModelBreakdownSchema = codexUsageTokenTotalsSchema
  .extend({
    model: z.string().min(1).max(200),
    serviceTier: codexUsageServiceTierSchema.default('UNKNOWN'),
    inferredServiceTierTokens: nonNegativeIntegerSchema.default(0),
    requestCount: nonNegativeIntegerSchema,
    sessionCount: nonNegativeIntegerSchema,
    longContextRequestCount: nonNegativeIntegerSchema,
  })
  .strict();

export const codexUsageDailyBreakdownSchema = codexUsageTokenTotalsSchema
  .extend({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    requestCount: nonNegativeIntegerSchema,
    sessionCount: nonNegativeIntegerSchema,
  })
  .strict();

export const codexUsageTurnSpeedTierSummarySchema = z
  .object({
    completedTurnCount: nonNegativeIntegerSchema,
    medianDurationMs: nonNegativeNumberSchema.nullable(),
  })
  .strict();

export const codexUsageTurnSpeedComparisonSchema = z
  .object({
    model: z.string().min(1).max(200),
    reasoningEffort: z.string().min(1).max(100),
    standard: codexUsageTurnSpeedTierSummarySchema,
    fast: codexUsageTurnSpeedTierSummarySchema,
    actualSpeedMultiplier: z.number().finite().positive().nullable(),
  })
  .strict();

export const codexUsageTurnSpeedAnalysisSchema = z
  .object({
    definition: z.literal('TASK_COMPLETE_DURATION'),
    algorithmVersion: z.literal(1),
    comparisonScope: z.literal('SINGLE_NORMALIZED_MODEL_AND_REASONING_EFFORT'),
    rangeAssignment: z.literal('COMPLETION_TIMESTAMP'),
    officialSpeedMultiplier: z.literal(1.5),
    completedTurnCount: nonNegativeIntegerSchema,
    validTurnCount: nonNegativeIntegerSchema,
    comparableTurnCount: nonNegativeIntegerSchema,
    excludedInvalidDurationTurnCount: nonNegativeIntegerSchema,
    excludedUnknownServiceTierTurnCount: nonNegativeIntegerSchema,
    excludedUnknownCohortTurnCount: nonNegativeIntegerSchema,
    comparisons: z.array(codexUsageTurnSpeedComparisonSchema).max(1_000),
  })
  .strict();

export const codexUsageSessionSourceSchema = z.enum(['USER_DIRECT', 'USER_FORK', 'SUBAGENT']);

export const codexUsageSessionLengthRangeSchema = z
  .object({
    minimumTurns: positiveIntegerSchema,
    maximumTurns: positiveIntegerSchema.nullable(),
  })
  .strict();

const codexUsageSessionTurnDistributionEntrySchema = z
  .object({
    chatTurns: positiveIntegerSchema,
    sessionCount: positiveIntegerSchema,
  })
  .strict();

export const codexUsageSessionLengthBucketSchema = codexUsageSessionLengthRangeSchema
  .extend({
    sessionCount: nonNegativeIntegerSchema,
    totalChatTurns: nonNegativeIntegerSchema,
    sessionTurnDistribution: z.array(codexUsageSessionTurnDistributionEntrySchema).max(10_000).default([]),
    medianUncachedInputTokensPerTurn: nonNegativeNumberSchema,
    medianCachedInputTokensPerTurn: nonNegativeNumberSchema,
    medianCacheWriteInputTokensPerTurn: nonNegativeNumberSchema,
    medianOutputTokensPerTurn: nonNegativeNumberSchema,
    medianReasoningOutputTokensPerTurn: nonNegativeNumberSchema,
    medianTotalTokensPerTurn: nonNegativeNumberSchema,
    medianApiEquivalentUsdPerTurn: nullableMoneySchema,
    averageContextCompactions: nonNegativeNumberSchema.nullable().default(null),
    apiPricedSessionCount: nonNegativeIntegerSchema,
    apiPricingCoveragePercent: percentageSchema,
    percentile25PeakContextTokens: nonNegativeNumberSchema,
    percentile75PeakContextTokens: nonNegativeNumberSchema,
  })
  .strict();

export const codexUsageSessionLengthTrendSchema = codexUsageSessionLengthRangeSchema
  .extend({ relativeToLowestPercent: nonNegativeNumberSchema })
  .strict();

export const codexUsageSessionLengthComparisonSchema = z
  .object({
    source: codexUsageSessionSourceSchema,
    model: z.string().min(1).max(200),
    sessionCount: nonNegativeIntegerSchema,
    totalChatTurns: nonNegativeIntegerSchema,
    medianSessionTurns: nonNegativeNumberSchema,
    percentile90SessionTurns: nonNegativeNumberSchema,
    maximumSessionTurns: nonNegativeIntegerSchema,
    averageContextCompactions: nonNegativeNumberSchema.nullable().default(null),
    apiPricedSessionCount: nonNegativeIntegerSchema,
    apiPricingCoveragePercent: percentageSchema,
    buckets: z.array(codexUsageSessionLengthBucketSchema).min(1).max(64),
    lowestMedianTokenRanges: z.array(codexUsageSessionLengthRangeSchema).max(64),
    lowestMedianApiCostRanges: z.array(codexUsageSessionLengthRangeSchema).max(64),
    sustainedApiCostIncrease: codexUsageSessionLengthTrendSchema.nullable(),
  })
  .strict();

export const codexUsageSessionLengthAnalysisSchema = z
  .object({
    definition: z.literal('COMPLETE_SESSION_CHAT_TURNS'),
    algorithmVersion: z.union([z.literal(2), z.literal(3)]),
    comparisonScope: z.literal('SESSION_SOURCE_AND_SINGLE_NORMALIZED_MODEL'),
    bucketStrategy: z.literal('DYNAMIC_EQUAL_SESSION_COUNT'),
    rangeAssignment: z.literal('LAST_TERMINAL_OWNED_CHAT_TURN'),
    contextDefinition: z.literal('SESSION_MAXIMUM_INPUT_TOKENS'),
    signalMinimumSessions: z.literal(5),
    signalMinimumPricedSessions: z.literal(5),
    sourceSessionCount: nonNegativeIntegerSchema,
    rangeSessionCount: nonNegativeIntegerSchema,
    comparisonSessionCount: nonNegativeIntegerSchema,
    excludedUnsupportedSourceSessionCount: nonNegativeIntegerSchema,
    excludedIncompleteSessionCount: nonNegativeIntegerSchema,
    excludedNoOwnedTurnSessionCount: nonNegativeIntegerSchema,
    excludedOpenSessionCount: nonNegativeIntegerSchema,
    excludedOutsideRangeSessionCount: nonNegativeIntegerSchema,
    excludedNoUsageSessionCount: nonNegativeIntegerSchema,
    excludedUnknownModelSessionCount: nonNegativeIntegerSchema,
    excludedMixedModelSessionCount: nonNegativeIntegerSchema,
    mixedServiceTierSessionCount: nonNegativeIntegerSchema,
    unknownServiceTierSessionCount: nonNegativeIntegerSchema,
    comparisons: z.array(codexUsageSessionLengthComparisonSchema).max(1_000),
  })
  .strict();

export const codexUsageQuotaWindowSchema = z
  .object({
    usedPercent: percentageSchema,
    windowDurationMins: nonNegativeNumberSchema.nullable(),
    resetsAt: nonNegativeIntegerSchema.nullable(),
  })
  .strict();

export const codexUsageQuotaLimitSchema = z
  .object({
    limitId: z.string().max(512).nullable(),
    limitName: z.string().max(2_000).nullable(),
    planType: z.string().max(2_000).nullable(),
    primary: codexUsageQuotaWindowSchema.nullable(),
    secondary: codexUsageQuotaWindowSchema.nullable(),
    rateLimitReachedType: z.string().max(200).nullable(),
  })
  .strict();

export const codexUsageQuotaSnapshotSchema = z
  .object({
    capturedAt: z.string().datetime(),
    planType: z.string().max(2_000).nullable(),
    limits: z.array(codexUsageQuotaLimitSchema).max(1_000),
    credits: z
      .object({
        hasCredits: z.boolean(),
        unlimited: z.boolean(),
        balance: z.string().max(200).nullable(),
      })
      .strict()
      .nullable(),
    individualLimit: z
      .object({
        limit: z.string().max(200),
        used: z.string().max(200),
        remainingPercent: z.number().finite(),
        resetsAt: nonNegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    resetCreditCount: nonNegativeIntegerSchema,
  })
  .strict();

export const codexUsageQuotaStateSchema = z.enum(['LIVE', 'PERMISSION_REQUIRED', 'CODEX_UNAVAILABLE', 'UNAVAILABLE']);

export const codexUsageWarningCodeSchema = z.enum([
  'SOURCE_UNAVAILABLE',
  'FILES_SKIPPED',
  'INVALID_RECORDS',
  'OVERSIZED_RECORDS',
  'UNPRICED_MODELS',
  'PARTIAL_RANGE',
  'QUOTA_UNAVAILABLE',
  'FAST_MODE_NOT_DETECTED',
  'QUOTA_YIELD_UNAVAILABLE',
  'QUOTA_YIELD_PARTIAL',
  'QUOTA_SAMPLES_TRUNCATED',
  'DATABASE_INDEX_UNAVAILABLE',
  'EXPORT_ROWS_TRUNCATED',
]);

export const codexUsagePricingBasisSchema = z
  .object({
    apiVerifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    apiSourceUrl: z.string().url(),
    creditVerifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    creditSourceUrl: z.string().url(),
    longContextThresholdTokens: nonNegativeIntegerSchema,
  })
  .strict();

export const codexUsageInvestigationSchema = z
  .object({
    investigationId: z.string().uuid(),
    generatedAt: z.string().datetime(),
    range: codexUsageRangeSchema,
    dateRange: codexUsageDateRangeSchema.nullable().default(null),
    timeZone: codexUsageTimeZoneSchema.default('UTC'),
    granularity: codexUsageGranularitySchema.default('AUTO'),
    from: z.string().datetime().nullable(),
    to: z.string().datetime(),
    sourceLabel: z.string().min(1).max(500),
    sourceMode: z.enum(['CODEX_DATABASE', 'FILESYSTEM_FALLBACK']),
    sessionCount: nonNegativeIntegerSchema,
    requestCount: nonNegativeIntegerSchema,
    filesDiscovered: nonNegativeIntegerSchema,
    filesScanned: nonNegativeIntegerSchema,
    filesCached: nonNegativeIntegerSchema,
    filesSkipped: nonNegativeIntegerSchema,
    relevantInvalidRecords: nonNegativeIntegerSchema,
    oversizedRecords: nonNegativeIntegerSchema,
    bytesRead: nonNegativeIntegerSchema,
    durationMs: nonNegativeIntegerSchema,
    totals: codexUsageTokenTotalsSchema,
    models: z.array(codexUsageModelBreakdownSchema).max(1_000),
    days: z.array(codexUsageDailyBreakdownSchema).max(10_000),
    turnSpeed: codexUsageTurnSpeedAnalysisSchema.nullable().default(null),
    sessionLength: codexUsageSessionLengthAnalysisSchema.nullable().default(null),
    quotaYield: codexUsageQuotaYieldAnalysisSchema.nullable().default(null),
    quotaState: codexUsageQuotaStateSchema,
    quotaMessage: z.string().max(2_000).nullable(),
    quota: codexUsageQuotaSnapshotSchema.nullable(),
    pricing: codexUsagePricingBasisSchema,
    warnings: z.array(codexUsageWarningCodeSchema).max(20),
  })
  .strict()
  .refine(customRangeIsConsistent, { message: customRangeMessage, path: ['dateRange'] });

export const codexUsageScanProgressSchema = z
  .object({
    phase: z.enum(['DISCOVERING', 'SCANNING', 'FINALIZING']),
    filesDiscovered: nonNegativeIntegerSchema,
    filesProcessed: nonNegativeIntegerSchema,
    filesScanned: nonNegativeIntegerSchema,
    filesCached: nonNegativeIntegerSchema,
    bytesRead: nonNegativeIntegerSchema,
    bytesTotal: nonNegativeIntegerSchema,
    throughputBytesPerSecond: nonNegativeNumberSchema,
    estimatedRemainingMs: nonNegativeIntegerSchema.nullable(),
    calculationPercent: percentageSchema.default(0),
    elapsedMs: nonNegativeIntegerSchema,
  })
  .strict();

export const codexUsageTaskStatusSchema = z.enum([
  'RUNNING',
  'PAUSED',
  'INTERRUPTED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const codexUsageTaskSchema = z
  .object({
    taskId: z.string().uuid(),
    range: codexUsageRangeSchema,
    dateRange: codexUsageDateRangeSchema.nullable().default(null),
    timeZone: codexUsageTimeZoneSchema.default('UTC'),
    granularity: codexUsageGranularitySchema.default('AUTO'),
    detailedStatistics: z.boolean().default(false),
    status: codexUsageTaskStatusSchema,
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    fromEpoch: nonNegativeIntegerSchema.nullable(),
    toEpoch: nonNegativeIntegerSchema,
    progress: codexUsageScanProgressSchema,
    investigationId: z.string().uuid().nullable(),
    errorMessage: z.string().max(2_000).nullable(),
  })
  .strict()
  .refine(customRangeIsConsistent, { message: customRangeMessage, path: ['dateRange'] });

export const codexUsageHistoryItemSchema = z
  .object({
    investigationId: z.string().uuid(),
    generatedAt: z.string().datetime(),
    range: codexUsageRangeSchema,
    dateRange: codexUsageDateRangeSchema.nullable().default(null),
    timeZone: codexUsageTimeZoneSchema.default('UTC'),
    granularity: codexUsageGranularitySchema.default('AUTO'),
    detailedStatistics: z.boolean().default(false),
    algorithmVersion: nonNegativeIntegerSchema.default(7),
    yieldEstimateCount: nonNegativeIntegerSchema.default(0),
    yieldSampleCount: nonNegativeIntegerSchema.default(0),
    from: z.string().datetime().nullable(),
    to: z.string().datetime(),
    sessionCount: nonNegativeIntegerSchema,
    requestCount: nonNegativeIntegerSchema,
    totalTokens: nonNegativeIntegerSchema,
    apiEquivalentUsd: nullableMoneySchema,
    filesScanned: nonNegativeIntegerSchema,
    filesCached: nonNegativeIntegerSchema,
    bytesRead: nonNegativeIntegerSchema,
    durationMs: nonNegativeIntegerSchema,
  })
  .strict()
  .refine(customRangeIsConsistent, { message: customRangeMessage, path: ['dateRange'] });

export const codexUsageStateSchema = z
  .object({
    task: codexUsageTaskSchema.nullable(),
    history: z.array(codexUsageHistoryItemSchema).max(50),
  })
  .strict();

export const codexUsageCleanupLevelSchema = z.enum(['HISTORY', 'ANALYSIS_CACHE', 'LOCAL_INDEX']);

export const codexUsageCleanupInputSchema = z
  .object({
    level: codexUsageCleanupLevelSchema,
  })
  .strict();

export const codexUsageCleanupCountsSchema = z
  .object({
    scanTasks: nonNegativeIntegerSchema,
    processedResults: nonNegativeIntegerSchema,
    sessionAnalyses: nonNegativeIntegerSchema,
    sourceFiles: nonNegativeIntegerSchema,
    usageEvents: nonNegativeIntegerSchema,
  })
  .strict();

export const codexUsageCleanupResultSchema = z
  .object({
    level: codexUsageCleanupLevelSchema,
    removed: codexUsageCleanupCountsSchema,
    state: codexUsageStateSchema,
  })
  .strict();

export const codexUsageResumeInputSchema = z
  .object({
    taskId: z.string().uuid(),
  })
  .strict();

export const codexUsageInvestigationGetInputSchema = z
  .object({
    investigationId: z.string().uuid(),
  })
  .strict();

export const codexUsageExportFormatSchema = z.enum(['CSV', 'JSON']);

export const codexUsageExportInputSchema = z
  .object({
    investigationId: z.string().uuid(),
    format: codexUsageExportFormatSchema,
  })
  .strict();

export const codexUsageExportResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z
    .object({
      status: z.literal('exported'),
      fileName: z.string().min(1).max(500),
    })
    .strict(),
]);

export type CodexUsageRange = z.infer<typeof codexUsageRangeSchema>;
export type CodexUsageDateRange = z.infer<typeof codexUsageDateRangeSchema>;
export type CodexUsageGranularity = z.infer<typeof codexUsageGranularitySchema>;
export type CodexUsageResolvedGranularity = z.infer<typeof codexUsageResolvedGranularitySchema>;
export type CodexUsageServiceTier = z.infer<typeof codexUsageServiceTierSchema>;
export type CodexUsageQuotaKind = z.infer<typeof codexUsageQuotaKindSchema>;
export type CodexUsageObservedServiceTier = z.infer<typeof codexUsageObservedServiceTierSchema>;
export type CodexUsageQuotaYieldAttribution = z.infer<typeof codexUsageQuotaYieldAttributionSchema>;
export type CodexUsageQuotaYieldServiceTier = z.infer<typeof codexUsageQuotaYieldServiceTierSchema>;
export type CodexUsageQuotaWindowKind = z.infer<typeof codexUsageQuotaWindowKindSchema>;
export type CodexUsageScanInput = z.infer<typeof codexUsageScanInputSchema>;
export type CodexUsageQuotaYieldSample = z.infer<typeof codexUsageQuotaYieldSampleSchema>;
export type CodexUsageQuotaYieldEstimate = z.infer<typeof codexUsageQuotaYieldEstimateSchema>;
export type CodexUsageQuotaYieldTimeSlice = z.infer<typeof codexUsageQuotaYieldTimeSliceSchema>;
export type CodexUsageQuotaResetObservationKind = z.infer<typeof codexUsageQuotaResetObservationKindSchema>;
export type CodexUsageQuotaResetObservation = z.infer<typeof codexUsageQuotaResetObservationSchema>;
export type CodexUsageQuotaCycleModelShare = z.infer<typeof codexUsageQuotaCycleModelShareSchema>;
export type CodexUsageQuotaCycle = z.infer<typeof codexUsageQuotaCycleSchema>;
export type CodexUsageQuotaYieldAnalysis = z.infer<typeof codexUsageQuotaYieldAnalysisSchema>;
export type CodexUsageTokenTotals = z.infer<typeof codexUsageTokenTotalsSchema>;
export type CodexUsageModelBreakdown = z.infer<typeof codexUsageModelBreakdownSchema>;
export type CodexUsageDailyBreakdown = z.infer<typeof codexUsageDailyBreakdownSchema>;
export type CodexUsageTurnSpeedTierSummary = z.infer<typeof codexUsageTurnSpeedTierSummarySchema>;
export type CodexUsageTurnSpeedComparison = z.infer<typeof codexUsageTurnSpeedComparisonSchema>;
export type CodexUsageTurnSpeedAnalysis = z.infer<typeof codexUsageTurnSpeedAnalysisSchema>;
export type CodexUsageSessionSource = z.infer<typeof codexUsageSessionSourceSchema>;
export type CodexUsageSessionLengthRange = z.infer<typeof codexUsageSessionLengthRangeSchema>;
export type CodexUsageSessionLengthBucket = z.infer<typeof codexUsageSessionLengthBucketSchema>;
export type CodexUsageSessionLengthTrend = z.infer<typeof codexUsageSessionLengthTrendSchema>;
export type CodexUsageSessionLengthComparison = z.infer<typeof codexUsageSessionLengthComparisonSchema>;
export type CodexUsageSessionLengthAnalysis = z.infer<typeof codexUsageSessionLengthAnalysisSchema>;
export type CodexUsageQuotaWindow = z.infer<typeof codexUsageQuotaWindowSchema>;
export type CodexUsageQuotaLimit = z.infer<typeof codexUsageQuotaLimitSchema>;
export type CodexUsageQuotaSnapshot = z.infer<typeof codexUsageQuotaSnapshotSchema>;
export type CodexUsageQuotaState = z.infer<typeof codexUsageQuotaStateSchema>;
export type CodexUsageWarningCode = z.infer<typeof codexUsageWarningCodeSchema>;
export type CodexUsagePricingBasis = z.infer<typeof codexUsagePricingBasisSchema>;
export type CodexUsageInvestigation = z.infer<typeof codexUsageInvestigationSchema>;
export type CodexUsageScanProgress = z.infer<typeof codexUsageScanProgressSchema>;
export type CodexUsageTaskStatus = z.infer<typeof codexUsageTaskStatusSchema>;
export type CodexUsageTask = z.infer<typeof codexUsageTaskSchema>;
export type CodexUsageHistoryItem = z.infer<typeof codexUsageHistoryItemSchema>;
export type CodexUsageState = z.infer<typeof codexUsageStateSchema>;
export type CodexUsageCleanupLevel = z.infer<typeof codexUsageCleanupLevelSchema>;
export type CodexUsageCleanupInput = z.infer<typeof codexUsageCleanupInputSchema>;
export type CodexUsageCleanupCounts = z.infer<typeof codexUsageCleanupCountsSchema>;
export type CodexUsageCleanupResult = z.infer<typeof codexUsageCleanupResultSchema>;
export type CodexUsageResumeInput = z.infer<typeof codexUsageResumeInputSchema>;
export type CodexUsageInvestigationGetInput = z.infer<typeof codexUsageInvestigationGetInputSchema>;
export type CodexUsageExportFormat = z.infer<typeof codexUsageExportFormatSchema>;
export type CodexUsageExportInput = z.infer<typeof codexUsageExportInputSchema>;
export type CodexUsageExportResult = z.infer<typeof codexUsageExportResultSchema>;
