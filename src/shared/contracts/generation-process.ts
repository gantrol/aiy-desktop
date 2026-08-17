import { z } from 'zod';

const processIdSchema = z.string().min(1).max(200);
const processKeySchema = z.string().min(1).max(200);
const processTimestampSchema = z.string().min(1).max(100);
const nullableProcessTimestampSchema = processTimestampSchema.nullable();
const nullableProcessKeySchema = processKeySchema.nullable();

export const generationProcessStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
]);

/**
 * A light, read-only summary for one image-generation run. It deliberately
 * excludes checkpoints, request bodies, response bodies, and error messages.
 */
export const generationProcessSummarySchema = z
  .object({
    runId: processIdSchema,
    jobId: processIdSchema,
    rootRunId: processIdSchema,
    retryOfRunId: processIdSchema.nullable(),
    status: generationProcessStatusSchema,
    phase: processKeySchema,
    progress: z.number().min(0).max(1).nullable(),
    statusMessage: z.string().max(1_000).nullable(),
    statusMessageOmitted: z.boolean(),
    providerKey: nullableProcessKeySchema,
    hasProviderRequestId: z.boolean(),
    errorCode: nullableProcessKeySchema,
    errorCodeOmitted: z.boolean(),
    attemptCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    outputCount: z.number().int().nonnegative(),
    latestSequence: z.number().int().nonnegative(),
    createdAt: processTimestampSchema,
    startedAt: nullableProcessTimestampSchema,
    finishedAt: nullableProcessTimestampSchema,
    updatedAt: processTimestampSchema,
  })
  .strict();

export const generationProcessEventPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE') }).strict(),
  z
    .object({
      kind: z.literal('PROVIDER_REQUEST'),
      providerKey: nullableProcessKeySchema,
      hasProviderRequestId: z.boolean(),
      remoteOperationAccepted: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('FAILURE'),
      errorCode: nullableProcessKeySchema,
      retryable: z.boolean().nullable(),
      providerCode: nullableProcessKeySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('OUTPUT'),
      assetId: processIdSchema,
      hasProviderOutputId: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('UNAVAILABLE'),
      reason: z.enum(['MALFORMED', 'OVERSIZED', 'UNSUPPORTED_EVENT']),
    })
    .strict(),
]);

export const generationProcessEventHeaderSchema = z
  .object({
    id: processIdSchema,
    attemptId: processIdSchema.nullable(),
    sequence: z.number().int().positive(),
    eventType: processKeySchema,
    phase: processKeySchema.nullable(),
    progress: z.number().min(0).max(1).nullable(),
    statusMessage: z.string().max(1_000).nullable(),
    statusMessageOmitted: z.boolean(),
    payload: generationProcessEventPayloadSchema,
    createdAt: processTimestampSchema,
  })
  .strict();

export const generationProcessEventPageInputSchema = z
  .object({
    runId: processIdSchema,
    /** Exclusive keyset cursor. Omit or pass null for the first page. */
    afterSequence: z.number().int().nonnegative().nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const generationProcessEventPageSchema = z
  .object({
    runId: processIdSchema,
    items: z.array(generationProcessEventHeaderSchema).max(100),
    /** Last returned sequence; pass it as afterSequence to continue or poll. */
    nextCursor: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export type GenerationProcessStatus = z.infer<typeof generationProcessStatusSchema>;
export type GenerationProcessSummaryDto = z.infer<typeof generationProcessSummarySchema>;
export type GenerationProcessEventPayloadDto = z.infer<typeof generationProcessEventPayloadSchema>;
export type GenerationProcessEventHeaderDto = z.infer<typeof generationProcessEventHeaderSchema>;
export type GenerationProcessEventPageInput = z.input<typeof generationProcessEventPageInputSchema>;
export type GenerationProcessEventPageDto = z.infer<typeof generationProcessEventPageSchema>;
