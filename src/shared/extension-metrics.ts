import { z } from 'zod';

export const CODEX_LOCAL_METRIC_PROVIDER_ID = 'codex.localMetrics';
export const CODEX_QUOTA_METRIC_PROVIDER_ID = 'codex.quotaMetrics';
export const OPENAI_COSTS_METRIC_PROVIDER_ID = 'openai.organizationCosts';

const identifier = z.string().min(1).max(512);
const recordIdentifier = z.string().min(1).max(1200);
const instant = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().safe().nullable();
/** Stable renderer message identifiers; localized text never crosses the main/renderer boundary. */
const messageKey = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/)
  .max(200);

/** Decimal text avoids rounding money while crossing JSON/IPC boundaries. */
export const extensionMetricDecimalSchema = z
  .string()
  .max(100)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const extensionMetricKindSchema = z.enum(['USAGE', 'COST', 'QUOTA']);
export const extensionMetricScopeSchema = z
  .object({
    kind: z.enum(['SPACE', 'DEVICE', 'ACCOUNT']),
    /** Opaque identity. Null means that this source cannot identify the account/device. */
    id: identifier.nullable(),
    identityBasis: z.enum(['LOCAL_SPACE', 'LOCAL_DEVICE', 'CONNECTION', 'PROVIDER_VERIFIED', 'UNIDENTIFIED']),
    labelKey: messageKey,
    labelValue: identifier.nullable(),
  })
  .strict()
  .superRefine((scope, context) => {
    if (scope.kind === 'SPACE' && (!scope.id || scope.identityBasis !== 'LOCAL_SPACE')) {
      context.addIssue({ code: 'custom', message: 'Space metrics require the current local space identity' });
    }
    if (scope.kind !== 'SPACE' && scope.identityBasis === 'LOCAL_SPACE') {
      context.addIssue({ code: 'custom', message: 'Local space identity cannot identify an external account' });
    }
  });

export const extensionMetricSourceSchema = z
  .object({
    id: identifier,
    extensionId: identifier,
    nameKey: messageKey,
    scope: extensionMetricScopeSchema,
    kinds: z.array(extensionMetricKindSchema).min(1).max(3),
    available: z.boolean(),
    unavailableReason: z.enum(['DISABLED', 'PERMISSION_REQUIRED', 'UNCONFIGURED', 'UNAVAILABLE']).nullable(),
    missingPermissions: z.array(z.string().min(1).max(240)).max(80),
    refreshMissingPermissions: z.array(z.string().min(1).max(240)).max(80),
    refresh: z.enum(['NONE', 'QUERY_RANGE', 'CURRENT_SNAPSHOT']),
    notes: z.array(messageKey).max(30),
  })
  .strict();

const periodSchema = z
  .object({ startAt: instant, endAt: instant })
  .strict()
  .refine((period) => Date.parse(period.startAt) <= Date.parse(period.endAt), 'Invalid metric period');

const baseFact = {
  /** Stable within one source and scope; repeated reads must not create another consumption record. */
  id: recordIdentifier,
  revision: identifier,
  period: periodSchema,
  /** Collection time, when known. It is not silently replaced with the current read time. */
  observedAt: instant.nullable(),
  originalRecord: z.object({ type: identifier, id: recordIdentifier }).strict(),
  notes: z.array(messageKey).max(30),
};

export const extensionUsageFactSchema = z
  .object({
    ...baseFact,
    kind: z.literal('USAGE'),
    basis: z.enum(['PROVIDER_REPORTED', 'PLUGIN_RECONSTRUCTED']),
    temporality: z.enum(['DELTA', 'CUMULATIVE']),
    completeness: z.enum(['COMPLETE', 'PARTIAL', 'UNKNOWN']),
    requestedModel: identifier.nullable(),
    observedModel: identifier.nullable(),
    /** Context/fallback labels are separate from requested and provider-observed models. */
    contextModel: identifier.nullable(),
    requests: count,
    inputTokens: count,
    cachedInputTokens: count,
    outputTokens: count,
    reasoningOutputTokens: count,
    totalTokens: count,
    images: count,
    durationSeconds: z.number().finite().nonnegative().nullable(),
  })
  .strict()
  .superRefine((fact, context) => {
    if (fact.inputTokens !== null && fact.cachedInputTokens !== null && fact.cachedInputTokens > fact.inputTokens) {
      context.addIssue({ code: 'custom', message: 'Cached input tokens exceed input tokens' });
    }
    if (
      fact.outputTokens !== null &&
      fact.reasoningOutputTokens !== null &&
      fact.reasoningOutputTokens > fact.outputTokens
    ) {
      context.addIssue({ code: 'custom', message: 'Reasoning output tokens exceed output tokens' });
    }
    if (
      fact.totalTokens !== null &&
      ((fact.inputTokens !== null && fact.totalTokens < fact.inputTokens) ||
        (fact.outputTokens !== null && fact.totalTokens < fact.outputTokens))
    ) {
      context.addIssue({ code: 'custom', message: 'Total tokens are smaller than a known component' });
    }
  });

export const extensionCostFactSchema = z
  .object({
    ...baseFact,
    kind: z.literal('COST'),
    basis: z.enum(['PROVIDER_REPORTED', 'ESTIMATE', 'PUBLIC_RATE_EQUIVALENT']),
    amount: extensionMetricDecimalSchema.nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    /** Required for estimates; the host never supplies a price for an unpriced model. */
    pricingReference: z.string().min(1).max(1000).nullable(),
    lineItem: z.string().max(512).nullable(),
    projectId: identifier.nullable(),
    apiKeyId: identifier.nullable(),
    quantity: extensionMetricDecimalSchema.nullable(),
    quantityUnit: z.string().min(1).max(160).nullable(),
  })
  .strict()
  .refine(
    (fact) => fact.basis === 'PROVIDER_REPORTED' || fact.pricingReference !== null,
    'Estimate requires pricing provenance',
  );

export const extensionQuotaFactSchema = z
  .object({
    ...baseFact,
    kind: z.literal('QUOTA'),
    basis: z.enum(['PROVIDER_REPORTED', 'LOCAL_LOG_SAMPLE']),
    poolId: identifier.nullable(),
    poolName: z.string().max(2000).nullable(),
    window: z.enum(['PRIMARY', 'SECONDARY', 'OTHER']),
    windowDurationSeconds: z.number().finite().nonnegative().nullable(),
    usedPercent: z.number().finite().nonnegative().nullable(),
    used: extensionMetricDecimalSchema.nullable(),
    limit: extensionMetricDecimalSchema.nullable(),
    remaining: extensionMetricDecimalSchema.nullable(),
    unit: z.string().min(1).max(160).nullable(),
    resetsAt: instant.nullable(),
  })
  .strict();

export const extensionMetricFactSchema = z.union([
  extensionUsageFactSchema,
  extensionCostFactSchema,
  extensionQuotaFactSchema,
]);

const rangeFields = { sourceId: identifier, startAt: instant, endAt: instant };
function validRange(range: { startAt: string; endAt: string }) {
  const duration = Date.parse(range.endAt) - Date.parse(range.startAt);
  return duration > 0 && duration <= 366 * 86_400_000;
}
export const extensionMetricQuerySchema = z
  .object({
    ...rangeFields,
    kinds: z.array(extensionMetricKindSchema).min(1).max(3).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).max(2000).optional(),
    snapshot: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .refine(validRange, 'Metric range must be positive and at most 366 days');

export const extensionMetricCoverageSchema = z
  .object({
    state: z.enum(['COMPLETE', 'PARTIAL', 'EMPTY', 'UNAVAILABLE']),
    /** Empty/missing data is not evidence of zero consumption or a zero balance. */
    notes: z.array(messageKey).max(30),
  })
  .strict();

export const extensionMetricQueryResultSchema = z
  .object({
    source: extensionMetricSourceSchema,
    startAt: instant,
    endAt: instant,
    /** Facts overlap the query; native provider buckets are never apportioned to another time zone. */
    rangeMatch: z.literal('OVERLAP'),
    snapshot: z.string().regex(/^[a-f0-9]{64}$/),
    facts: z.array(extensionMetricFactSchema).max(200),
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).max(2000).nullable(),
    coverage: extensionMetricCoverageSchema,
  })
  .strict()
  .refine((result) => result.hasMore === (result.nextCursor !== null), 'Pagination state is inconsistent');

export const extensionMetricRefreshSchema = z
  .object(rangeFields)
  .strict()
  .refine(validRange, 'Invalid metric refresh range');
export const extensionMetricRefreshResultSchema = z
  .object({
    source: extensionMetricSourceSchema,
    refreshedAt: instant,
    coverage: extensionMetricCoverageSchema,
  })
  .strict();

export const extensionMetricSourcesSchema = z.array(extensionMetricSourceSchema).max(200);
export type ExtensionMetricScope = z.infer<typeof extensionMetricScopeSchema>;
export type ExtensionMetricSource = z.infer<typeof extensionMetricSourceSchema>;
export type ExtensionMetricFact = z.infer<typeof extensionMetricFactSchema>;
export type ExtensionUsageFact = z.infer<typeof extensionUsageFactSchema>;
export type ExtensionCostFact = z.infer<typeof extensionCostFactSchema>;
export type ExtensionQuotaFact = z.infer<typeof extensionQuotaFactSchema>;
export type ExtensionMetricQuery = z.infer<typeof extensionMetricQuerySchema>;
export type ExtensionMetricQueryResult = z.infer<typeof extensionMetricQueryResultSchema>;
export type ExtensionMetricCoverage = z.infer<typeof extensionMetricCoverageSchema>;
export type ExtensionMetricRefresh = z.infer<typeof extensionMetricRefreshSchema>;
export type ExtensionMetricRefreshResult = z.infer<typeof extensionMetricRefreshResultSchema>;

export interface ExtensionMetricsApi {
  listSources(spaceId: string): Promise<ExtensionMetricSource[]>;
  query(input: ExtensionMetricQuery, spaceId: string): Promise<ExtensionMetricQueryResult>;
  refresh(input: ExtensionMetricRefresh, spaceId: string): Promise<ExtensionMetricRefreshResult>;
}
