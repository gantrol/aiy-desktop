import { z } from 'zod';

const count = z.number().int().nonnegative().safe();
const measurement = z.number().finite().nonnegative().nullable();

// Completion timestamp, duration, requests, total/output tokens, API USD, Credits.
// Compact numeric tuples avoid repeating field names and session identifiers per turn.
export const codexModelComparisonSampleSchema = z.tuple([
  count,
  measurement,
  count.nullable(),
  count.nullable(),
  count.nullable(),
  measurement,
  measurement,
]);

export const codexModelComparisonDistributionSchema = z
  .object({
    sampleCount: count.positive(),
    // Linearly interpolated quantiles at P0, P1, ... P100.
    percentiles: z.array(z.number().finite().nonnegative()).length(101),
  })
  .strict();

const distribution = codexModelComparisonDistributionSchema.nullable();
export const codexModelComparisonDistributionsSchema = z
  .object({
    durationMs: distribution,
    requests: distribution,
    totalTokens: distribution,
    outputTokens: distribution,
    apiEquivalentUsd: distribution,
    codexCredits: distribution,
  })
  .strict();

export const codexModelComparisonRowSchema = z
  .object({
    model: z.string().min(1).max(200),
    reasoningEffort: z.string().min(1).max(100).nullable(),
    serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']),
    completedTurnCount: count,
    sessionCount: count,
    durationTurnCount: count,
    usageTurnCount: count,
    apiPricedTurnCount: count,
    creditPricedTurnCount: count,
    medianDurationMs: measurement,
    medianRequests: measurement,
    medianTotalTokens: measurement,
    medianOutputTokens: measurement,
    medianApiEquivalentUsd: measurement,
    medianCodexCredits: measurement,
    cachedInputPercent: measurement,
    distributions: codexModelComparisonDistributionsSchema.nullable().default(null),
    // Retained only in byReasoningEffort so a turn is never duplicated across groupings.
    samples: z.array(codexModelComparisonSampleSchema).max(100_000).nullable().default(null),
  })
  .strict();

export const codexModelComparisonAnalysisSchema = z
  .object({
    definition: z.literal('OWNED_USER_COMPLETED_TURNS'),
    algorithmVersion: z.union([z.literal(1), z.literal(2)]),
    rangeAssignment: z.literal('COMPLETION_TIMESTAMP'),
    completedTurnCount: count,
    excludedModelTurnCount: count,
    samplesTruncated: z.boolean(),
    byModel: z.array(codexModelComparisonRowSchema).max(1_000),
    byReasoningEffort: z.array(codexModelComparisonRowSchema).max(1_000),
  })
  .strict();

export type CodexModelComparisonRow = z.infer<typeof codexModelComparisonRowSchema>;
export type CodexModelComparisonAnalysis = z.infer<typeof codexModelComparisonAnalysisSchema>;
export type CodexModelComparisonDistribution = z.infer<typeof codexModelComparisonDistributionSchema>;
export type CodexModelComparisonMetric = keyof z.infer<typeof codexModelComparisonDistributionsSchema>;
export type CodexModelComparisonSample = z.infer<typeof codexModelComparisonSampleSchema>;
