import { z } from 'zod';

const idSchema = z.string().min(1).max(200);
const localeSchema = z.enum(['zh', 'en']);
const dateTimeSchema = z.string().datetime({ offset: true });

export const termIllustrationPurposeSchema = z.enum(['COVER', 'RELATED']);
export const termIllustrationBatchStatusSchema = z.enum(['PREPARING', 'SUBMITTED', 'FAILED']);
export const termIllustrationDecisionSchema = z.enum(['PENDING', 'ADOPTED_COVER', 'ADOPTED_RELATED', 'DISMISSED']);
export const termIllustrationGenerationStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
]);
export const termIllustrationQualitySchema = z.enum(['low', 'medium', 'high']);

export const termIllustrationAssetSchema = z
  .object({
    id: idSchema,
    kind: z.enum(['GENERATED', 'REFERENCE']),
    originType: z.string().max(100).optional(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    mimeType: z.string().min(1).max(200),
    byteSize: z.number().int().nonnegative().optional(),
    mediaUrl: z.string().min(1),
    createdAt: dateTimeSchema,
  })
  .strict();

export const termIllustrationStartInputSchema = z
  .object({
    termId: idSchema,
    expectedTermRevisionId: idSchema,
    routeKey: idSchema,
    quality: termIllustrationQualitySchema,
    purpose: termIllustrationPurposeSchema,
    count: z.number().int().min(1).max(4),
    locale: localeSchema,
  })
  .strict();

export const termIllustrationListInputSchema = z
  .object({
    termId: idSchema,
    locale: localeSchema,
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const termIllustrationAdoptInputSchema = z
  .object({
    batchRunId: idSchema,
    role: termIllustrationPurposeSchema,
  })
  .strict();

export const termIllustrationDismissInputSchema = z.object({ batchRunId: idSchema }).strict();

export const termIllustrationRunSchema = z
  .object({
    id: idSchema,
    generationRunId: idSchema,
    status: termIllustrationGenerationStatusSchema,
    phase: z.string().min(1).max(100).nullable(),
    progress: z.number().min(0).max(1).nullable(),
    modelKey: idSchema,
    quality: termIllustrationQualitySchema,
    asset: termIllustrationAssetSchema.nullable(),
    errorCode: z.string().max(200).nullable(),
    errorMessage: z.string().max(10_000).nullable(),
    decision: termIllustrationDecisionSchema,
    termMediaLinkId: idSchema.nullable(),
    decidedAt: dateTimeSchema.nullable(),
    startedAt: dateTimeSchema.nullable(),
    finishedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
  })
  .strict();

export const termIllustrationBatchSchema = z
  .object({
    id: idSchema,
    termId: idSchema,
    termRevisionId: idSchema,
    purpose: termIllustrationPurposeSchema,
    profileId: idSchema,
    profileRevision: z.number().int().min(1),
    promptProfileId: idSchema,
    expressionRevisionId: idSchema,
    modelKey: idSchema,
    quality: termIllustrationQualitySchema,
    seriesId: idSchema.nullable(),
    promptVersionId: idSchema.nullable(),
    status: termIllustrationBatchStatusSchema,
    errorCode: z.string().max(200).nullable(),
    errorMessage: z.string().max(10_000).nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    runs: z.array(termIllustrationRunSchema).max(100),
  })
  .strict();

export const termIllustrationListSchema = z
  .object({
    batches: z.array(termIllustrationBatchSchema).max(50),
  })
  .strict();

export const termIllustrationStartResultSchema = z
  .object({
    batchId: idSchema,
    seriesId: idSchema,
    versionId: idSchema,
    runIds: z.array(idSchema).min(1).max(4),
  })
  .strict();

export const termIllustrationDecisionResultSchema = z
  .object({
    batchRunId: idSchema,
    decision: termIllustrationDecisionSchema,
    termMediaLinkId: idSchema.nullable(),
  })
  .strict();

export type TermIllustrationPurpose = z.infer<typeof termIllustrationPurposeSchema>;
export type TermIllustrationBatchStatus = z.infer<typeof termIllustrationBatchStatusSchema>;
export type TermIllustrationDecision = z.infer<typeof termIllustrationDecisionSchema>;
export type TermIllustrationStartInput = z.infer<typeof termIllustrationStartInputSchema>;
export type TermIllustrationListInput = z.infer<typeof termIllustrationListInputSchema>;
export type TermIllustrationAdoptInput = z.infer<typeof termIllustrationAdoptInputSchema>;
export type TermIllustrationDismissInput = z.infer<typeof termIllustrationDismissInputSchema>;
export type TermIllustrationRunDto = z.infer<typeof termIllustrationRunSchema>;
export type TermIllustrationBatchDto = z.infer<typeof termIllustrationBatchSchema>;
export type TermIllustrationListDto = z.infer<typeof termIllustrationListSchema>;
export type TermIllustrationStartResult = z.infer<typeof termIllustrationStartResultSchema>;
export type TermIllustrationDecisionResult = z.infer<typeof termIllustrationDecisionResultSchema>;
