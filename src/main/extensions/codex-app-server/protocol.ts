import { z } from 'zod';

export const CODEX_APP_SERVER_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

const boundedIdentifierSchema = z.string().min(1).max(512);
const boundedLabelSchema = z.string().max(2_000);
const nonNegativeIntegerSchema = z.number().int().nonnegative().safe();

export const codexReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

const accountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('apiKey') }).passthrough(),
  z
    .object({
      type: z.literal('chatgpt'),
      email: z.string().max(2_000).nullable(),
      planType: boundedLabelSchema,
    })
    .passthrough(),
  z
    .object({
      type: z.literal('amazonBedrock'),
      credentialSource: z.enum(['codexManaged', 'awsManaged']),
    })
    .passthrough(),
]);

export const accountReadResponseSchema = z
  .object({
    account: accountSchema.nullable(),
    requiresOpenaiAuth: z.boolean(),
  })
  .passthrough();

const reasoningEffortOptionSchema = z
  .object({
    reasoningEffort: z.string().min(1).max(100),
    description: boundedLabelSchema.optional(),
  })
  .passthrough();

export const modelCatalogEntrySchema = z
  .object({
    id: boundedIdentifierSchema.optional(),
    model: boundedIdentifierSchema.optional(),
    displayName: boundedLabelSchema.optional(),
    hidden: z.boolean().optional(),
    inputModalities: z.array(z.string().min(1).max(100)).max(20).optional(),
    isDefault: z.boolean().optional(),
    defaultReasoningEffort: z.string().min(1).max(100).nullable().optional(),
    supportedReasoningEfforts: z.array(reasoningEffortOptionSchema).max(20).optional(),
  })
  .passthrough()
  .refine((entry) => Boolean(entry.id || entry.model), { message: 'Model entry requires id or model' });

export const modelCatalogResponseSchema = z
  .object({
    data: z.array(modelCatalogEntrySchema).max(10_000),
    nextCursor: z.string().min(1).max(2_000).nullable().optional(),
  })
  .passthrough();

export const rateLimitReachedTypeSchema = z.enum([
  'rate_limit_reached',
  'workspace_owner_credits_depleted',
  'workspace_member_credits_depleted',
  'workspace_owner_usage_limit_reached',
  'workspace_member_usage_limit_reached',
]);

export const rateLimitWindowSchema = z
  .object({
    usedPercent: z.number().finite().nonnegative(),
    windowDurationMins: z.number().finite().nonnegative().nullable(),
    resetsAt: nonNegativeIntegerSchema.nullable(),
  })
  .passthrough();

export const creditsSnapshotSchema = z
  .object({
    hasCredits: z.boolean(),
    unlimited: z.boolean(),
    balance: z.string().max(200).nullable(),
  })
  .passthrough();

const spendControlLimitSnapshotSchema = z
  .object({
    limit: z.string().max(200),
    used: z.string().max(200),
    remainingPercent: z.number().finite(),
    resetsAt: nonNegativeIntegerSchema,
  })
  .passthrough();

/**
 * The read response currently sends every nullable field. Older servers and
 * sparse update notifications can omit them, so absence remains distinct from
 * an explicit null until a cache merge is performed.
 */
export const rateLimitSnapshotSchema = z
  .object({
    limitId: boundedIdentifierSchema.nullable().optional(),
    limitName: boundedLabelSchema.nullable().optional(),
    primary: rateLimitWindowSchema.nullable().optional(),
    secondary: rateLimitWindowSchema.nullable().optional(),
    credits: creditsSnapshotSchema.nullable().optional(),
    individualLimit: spendControlLimitSnapshotSchema.nullable().optional(),
    planType: boundedLabelSchema.nullable().optional(),
    rateLimitReachedType: rateLimitReachedTypeSchema.nullable().optional(),
  })
  .passthrough();

const rateLimitResetCreditSchema = z
  .object({
    id: boundedIdentifierSchema,
    resetType: boundedLabelSchema,
    status: boundedLabelSchema,
    grantedAt: nonNegativeIntegerSchema,
    expiresAt: nonNegativeIntegerSchema.nullable(),
    title: boundedLabelSchema.nullable(),
    description: z.string().max(20_000).nullable(),
  })
  .passthrough();

const rateLimitResetCreditsSummarySchema = z
  .object({
    availableCount: nonNegativeIntegerSchema,
    credits: z.array(rateLimitResetCreditSchema).max(1_000).nullable(),
  })
  .passthrough();

export const rateLimitsReadResponseSchema = z
  .object({
    rateLimits: rateLimitSnapshotSchema,
    rateLimitsByLimitId: z.record(z.string().min(1).max(512), rateLimitSnapshotSchema).nullable().optional(),
    rateLimitResetCredits: rateLimitResetCreditsSummarySchema.nullable().optional(),
  })
  .passthrough();

export const rateLimitsUpdatedNotificationSchema = z
  .object({
    rateLimits: rateLimitSnapshotSchema,
  })
  .passthrough();

export const tokenUsageBreakdownSchema = z
  .object({
    totalTokens: nonNegativeIntegerSchema,
    inputTokens: nonNegativeIntegerSchema,
    cachedInputTokens: nonNegativeIntegerSchema,
    outputTokens: nonNegativeIntegerSchema,
    reasoningOutputTokens: nonNegativeIntegerSchema,
  })
  .passthrough();

export const threadTokenUsageUpdatedNotificationSchema = z
  .object({
    threadId: boundedIdentifierSchema,
    turnId: boundedIdentifierSchema,
    tokenUsage: z
      .object({
        total: tokenUsageBreakdownSchema,
        last: tokenUsageBreakdownSchema,
        modelContextWindow: nonNegativeIntegerSchema.nullable(),
      })
      .passthrough(),
  })
  .passthrough();

export const itemCompletedNotificationSchema = z
  .object({
    threadId: boundedIdentifierSchema,
    turnId: boundedIdentifierSchema,
    item: z.object({ type: z.string().min(1).max(100) }).passthrough(),
  })
  .passthrough();

export const agentMessageCompletedItemSchema = z
  .object({
    type: z.literal('agentMessage'),
    text: z.string().max(16 * 1024 * 1024),
    phase: z.string().max(100).optional(),
  })
  .passthrough();

export const imageGenerationCompletedItemSchema = z
  .object({
    type: z.literal('imageGeneration'),
    savedPath: z.string().max(32_000).nullable().optional(),
    revisedPrompt: z.string().max(1_000_000).nullable().optional(),
    // App Server can return the complete generated image as Base64 when no
    // durable saved path is available. The transport already rejects any
    // message above this bound, so a smaller field limit would discard a
    // valid image and misclassify the completed turn as EMPTY_RESPONSE.
    result: z.string().max(CODEX_APP_SERVER_MAX_MESSAGE_BYTES).optional(),
  })
  .passthrough();

export const turnCompletedNotificationSchema = z
  .object({
    threadId: boundedIdentifierSchema,
    turn: z
      .object({
        id: boundedIdentifierSchema,
        status: z.enum(['completed', 'interrupted', 'failed']),
        error: z
          .object({
            message: z.string().max(100_000),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type CodexAppServerAccountReadResult = z.infer<typeof accountReadResponseSchema>;
export type CodexAppServerModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;
export type CodexAppServerModelCatalogPage = z.infer<typeof modelCatalogResponseSchema>;
export type CodexAppServerRateLimitSnapshot = z.infer<typeof rateLimitSnapshotSchema>;
export type CodexAppServerRateLimits = z.infer<typeof rateLimitsReadResponseSchema>;
export type CodexAppServerRateLimitsUpdate = z.infer<typeof rateLimitsUpdatedNotificationSchema>;
export type CodexAppServerTokenUsage = z.infer<typeof tokenUsageBreakdownSchema>;

export type CodexAppServerReadinessStatus =
  | 'AVAILABLE'
  | 'UNKNOWN'
  | 'NOT_LOGGED_IN'
  | 'MODEL_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'CREDITS_DEPLETED'
  | 'WORKSPACE_USAGE_LIMIT';

export type CodexAppServerReadinessProbe = 'ACCOUNT' | 'MODEL_CATALOG' | 'RATE_LIMITS';

export interface CodexAppServerReadinessDiagnostic {
  probe: CodexAppServerReadinessProbe;
  code: string;
  rpcCode?: number;
}

export interface CodexAppServerReadiness {
  status: CodexAppServerReadinessStatus;
  canStartTurn: boolean;
  retryable: boolean;
  resetAt: number | null;
  model: string;
  effort: z.infer<typeof codexReasoningEffortSchema>;
  limitId: string | null;
  diagnostics: CodexAppServerReadinessDiagnostic[];
}

export interface CodexAppServerReadinessEvaluationInput {
  model: string;
  effort: z.infer<typeof codexReasoningEffortSchema>;
  account: CodexAppServerAccountReadResult | null;
  accountProbeSucceeded: boolean;
  models: CodexAppServerModelCatalogEntry[];
  modelCatalogProbeSucceeded: boolean;
  modelCatalogComplete: boolean;
  rateLimits: CodexAppServerRateLimits | null;
  rateLimitsProbeSucceeded: boolean;
  diagnostics?: CodexAppServerReadinessDiagnostic[];
}

function readinessResult(
  input: CodexAppServerReadinessEvaluationInput,
  status: CodexAppServerReadinessStatus,
  diagnostics: CodexAppServerReadinessDiagnostic[],
  resetAt: number | null = null,
  limitId: string | null = null,
): CodexAppServerReadiness {
  return {
    status,
    canStartTurn: status === 'AVAILABLE' || status === 'UNKNOWN',
    retryable: status === 'UNKNOWN' || (status === 'RATE_LIMITED' && resetAt !== null),
    resetAt,
    model: input.model,
    effort: input.effort,
    limitId,
    diagnostics,
  };
}

function resetAtFor(snapshot: CodexAppServerRateLimitSnapshot) {
  return snapshot.primary?.resetsAt ?? snapshot.secondary?.resetsAt ?? snapshot.individualLimit?.resetsAt ?? null;
}

function classifyRateLimit(snapshot: CodexAppServerRateLimitSnapshot) {
  const resetAt = resetAtFor(snapshot);
  const limitId = snapshot.limitId ?? null;
  switch (snapshot.rateLimitReachedType) {
    case 'workspace_owner_credits_depleted':
    case 'workspace_member_credits_depleted':
      return { status: 'CREDITS_DEPLETED' as const, resetAt, limitId, code: 'CREDITS_DEPLETED' };
    case 'workspace_owner_usage_limit_reached':
    case 'workspace_member_usage_limit_reached':
      return { status: 'WORKSPACE_USAGE_LIMIT' as const, resetAt, limitId, code: 'WORKSPACE_USAGE_LIMIT' };
    case 'rate_limit_reached':
      return { status: 'RATE_LIMITED' as const, resetAt, limitId, code: 'RATE_LIMIT_REACHED' };
    default:
      break;
  }
  // `hasCredits` describes optional purchased credits, not the subscription
  // allowance. Only the explicit reached type can declare credit exhaustion.
  if ((snapshot.primary?.usedPercent ?? 0) >= 100 || (snapshot.secondary?.usedPercent ?? 0) >= 100) {
    return { status: 'RATE_LIMITED' as const, resetAt, limitId, code: 'RATE_LIMIT_REACHED' };
  }
  return null;
}

export function evaluateCodexAppServerReadiness(
  input: CodexAppServerReadinessEvaluationInput,
): CodexAppServerReadiness {
  const diagnostics = [...(input.diagnostics ?? [])];
  if (input.accountProbeSucceeded && input.account?.account === null && input.account.requiresOpenaiAuth === true) {
    diagnostics.push({ probe: 'ACCOUNT', code: 'ACCOUNT_NOT_LOGGED_IN' });
    return readinessResult(input, 'NOT_LOGGED_IN', diagnostics);
  }

  const matchingModel = input.models.find((entry) => entry.model === input.model || entry.id === input.model);
  if (input.modelCatalogProbeSucceeded && !matchingModel && input.modelCatalogComplete) {
    diagnostics.push({ probe: 'MODEL_CATALOG', code: 'MODEL_NOT_FOUND' });
    return readinessResult(input, 'MODEL_UNAVAILABLE', diagnostics);
  }
  if (matchingModel?.inputModalities && !matchingModel.inputModalities.includes('text')) {
    diagnostics.push({ probe: 'MODEL_CATALOG', code: 'TEXT_INPUT_UNSUPPORTED' });
    return readinessResult(input, 'MODEL_UNAVAILABLE', diagnostics);
  }
  if (
    matchingModel?.supportedReasoningEfforts &&
    !matchingModel.supportedReasoningEfforts.some((option) => option.reasoningEffort === input.effort)
  ) {
    diagnostics.push({ probe: 'MODEL_CATALOG', code: 'REASONING_EFFORT_UNSUPPORTED' });
    return readinessResult(input, 'MODEL_UNAVAILABLE', diagnostics);
  }

  const effortSupportUnknown = Boolean(matchingModel && matchingModel.supportedReasoningEfforts === undefined);

  const classifiedLimit = input.rateLimits ? classifyRateLimit(input.rateLimits.rateLimits) : null;
  if (classifiedLimit) {
    diagnostics.push({ probe: 'RATE_LIMITS', code: classifiedLimit.code });
    return readinessResult(
      input,
      classifiedLimit.status,
      diagnostics,
      classifiedLimit.resetAt,
      classifiedLimit.limitId,
    );
  }

  const incompleteCatalog = input.modelCatalogProbeSucceeded && !matchingModel && !input.modelCatalogComplete;
  if (
    !input.accountProbeSucceeded ||
    !input.modelCatalogProbeSucceeded ||
    incompleteCatalog ||
    effortSupportUnknown ||
    !input.rateLimitsProbeSucceeded
  ) {
    if (incompleteCatalog) diagnostics.push({ probe: 'MODEL_CATALOG', code: 'MODEL_CATALOG_INCOMPLETE' });
    if (effortSupportUnknown) diagnostics.push({ probe: 'MODEL_CATALOG', code: 'REASONING_EFFORT_UNKNOWN' });
    return readinessResult(input, 'UNKNOWN', diagnostics);
  }
  return readinessResult(input, 'AVAILABLE', diagnostics, null, input.rateLimits?.rateLimits.limitId ?? null);
}

function mergeNullableMetadata<T>(current: T | null | undefined, update: T | null | undefined) {
  return update === null || update === undefined ? current : update;
}

export function mergeCodexAppServerRateLimits(
  current: CodexAppServerRateLimits | null,
  update: CodexAppServerRateLimitsUpdate,
): CodexAppServerRateLimits {
  const previous = current?.rateLimits;
  const incoming = update.rateLimits;
  const merged: CodexAppServerRateLimitSnapshot = {
    ...previous,
    ...incoming,
    limitId: mergeNullableMetadata(previous?.limitId, incoming.limitId),
    limitName: mergeNullableMetadata(previous?.limitName, incoming.limitName),
    credits: mergeNullableMetadata(previous?.credits, incoming.credits),
    individualLimit: mergeNullableMetadata(previous?.individualLimit, incoming.individualLimit),
    planType: mergeNullableMetadata(previous?.planType, incoming.planType),
  };
  const previousById = current?.rateLimitsByLimitId;
  const limitId = merged.limitId;
  const rateLimitsByLimitId =
    previousById && limitId
      ? {
          ...previousById,
          [limitId]: {
            ...previousById[limitId],
            ...merged,
          },
        }
      : (previousById ?? null);
  return {
    rateLimits: merged,
    rateLimitsByLimitId,
    rateLimitResetCredits: current?.rateLimitResetCredits ?? null,
  };
}
