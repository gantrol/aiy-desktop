import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(200);
const extensionIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const channelIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const endpointIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const articleDeliveryExtensionTargetSchema = z
  .object({
    extensionId: extensionIdSchema,
    channelId: channelIdSchema,
  })
  .strict();

export const articleDeliveryConnectionStateSchema = z.enum(['NOT_CONFIGURED', 'UNVERIFIED', 'READY', 'ERROR']);

export const articleDeliveryConnectionDtoSchema = articleDeliveryExtensionTargetSchema
  .extend({
    configured: z.boolean(),
    state: articleDeliveryConnectionStateSchema,
    endpointId: endpointIdSchema.nullable(),
    siteUrl: z.string().url().nullable(),
    tokenHint: z.string().max(20).nullable(),
    message: z.string().max(500),
    lastVerifiedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const articleDeliveryConnectionSaveInputSchema = articleDeliveryExtensionTargetSchema
  .extend({
    endpointId: endpointIdSchema,
    token: z.string().max(500),
  })
  .strict();

export const articleDeliveryArticleTargetSchema = articleDeliveryExtensionTargetSchema
  .extend({
    spaceId: identifierSchema,
    articleId: identifierSchema,
  })
  .strict();

export const articleDeliveryArticleProfileSchema = articleDeliveryArticleTargetSchema
  .extend({
    slug: slugSchema,
    canonicalPath: z.string().startsWith('/').max(240),
    description: z.string().max(500),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const articleDeliveryArticleProfileSaveInputSchema = articleDeliveryArticleTargetSchema
  .extend({
    slug: slugSchema,
    description: z.string().trim().max(500),
  })
  .strict();

export const articleDeliveryStatusSchema = z
  .object({
    connection: articleDeliveryConnectionDtoSchema,
    profile: articleDeliveryArticleProfileSchema.nullable(),
  })
  .strict();

export const articleDeliveryUploadInputSchema = articleDeliveryArticleTargetSchema
  .extend({
    expectedRevisionId: identifierSchema,
  })
  .strict();

export const articleDeliveryUploadResultSchema = z
  .object({
    documentId: identifierSchema,
    revisionId: identifierSchema,
    version: z.number().int().positive(),
    canonicalPath: z.string().startsWith('/').max(240),
    adminUrl: z.string().url(),
    publicUrl: z.string().url(),
    unchanged: z.boolean(),
    replayed: z.boolean(),
    uploadedMedia: z.number().int().min(0).max(100),
    reusedMedia: z.number().int().min(0).max(100),
  })
  .strict();

export const articleDeliveryJobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']);

export const articleDeliveryJobSchema = articleDeliveryArticleTargetSchema
  .extend({
    id: identifierSchema,
    articleRevisionId: identifierSchema,
    articleContentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    targetSlug: slugSchema,
    targetDescription: z.string().max(500),
    status: articleDeliveryJobStatusSchema,
    attemptCount: z.number().int().nonnegative(),
    result: articleDeliveryUploadResultSchema.nullable(),
    errorCode: z.string().max(160).nullable(),
    errorMessage: z.string().max(1_000).nullable(),
    retryable: z.boolean(),
    retryOfJobId: identifierSchema.nullable(),
    createdAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const articleDeliveryJobListInputSchema = z
  .object({
    spaceId: identifierSchema,
    articleId: identifierSchema,
    limit: z.number().int().min(1).max(50),
  })
  .strict();

export const articleDeliveryJobRetryInputSchema = z.object({ jobId: identifierSchema }).strict();

export const articleDeliveryJobChangedEventSchema = z.object({ job: articleDeliveryJobSchema }).strict();

export type ArticleDeliveryExtensionTarget = z.infer<typeof articleDeliveryExtensionTargetSchema>;
export type ArticleDeliveryConnectionState = z.infer<typeof articleDeliveryConnectionStateSchema>;
export type ArticleDeliveryConnectionDto = z.infer<typeof articleDeliveryConnectionDtoSchema>;
export type ArticleDeliveryConnectionSaveInput = z.infer<typeof articleDeliveryConnectionSaveInputSchema>;
export type ArticleDeliveryArticleTarget = z.infer<typeof articleDeliveryArticleTargetSchema>;
export type ArticleDeliveryArticleProfile = z.infer<typeof articleDeliveryArticleProfileSchema>;
export type ArticleDeliveryArticleProfileSaveInput = z.infer<typeof articleDeliveryArticleProfileSaveInputSchema>;
export type ArticleDeliveryStatus = z.infer<typeof articleDeliveryStatusSchema>;
export type ArticleDeliveryUploadInput = z.infer<typeof articleDeliveryUploadInputSchema>;
export type ArticleDeliveryUploadResult = z.infer<typeof articleDeliveryUploadResultSchema>;
export type ArticleDeliveryJobStatus = z.infer<typeof articleDeliveryJobStatusSchema>;
export type ArticleDeliveryJob = z.infer<typeof articleDeliveryJobSchema>;
export type ArticleDeliveryJobListInput = z.infer<typeof articleDeliveryJobListInputSchema>;
export type ArticleDeliveryJobRetryInput = z.infer<typeof articleDeliveryJobRetryInputSchema>;
export type ArticleDeliveryJobChangedEvent = z.infer<typeof articleDeliveryJobChangedEventSchema>;
