import { z } from 'zod';

export const imageInputReasonSchema = z.enum([
  'UNSUPPORTED_FORMAT',
  'STATIC_IMAGE_UNAVAILABLE',
  'BYTE_LIMIT',
  'PIXEL_LIMIT',
  'DIMENSION_LIMIT',
  'RESOURCE_LIMIT',
  'SOURCE_MISSING',
  'SOURCE_UNREADABLE',
  'DECODE_FAILED',
  'INDEX_TIMEOUT',
  'INDEX_FAILED',
  'OCR_UNAVAILABLE',
  'UNKNOWN',
]);
export type ImageInputReason = z.infer<typeof imageInputReasonSchema>;
export const imageInputFailureSchema = z
  .object({
    reason: imageInputReasonSchema,
    stage: z.enum(['source', 'prepare', 'encode', 'ocr']).default('prepare'),
    actual: z.number().nonnegative().optional(),
    limit: z.number().positive().optional(),
  })
  .strict();
export type ImageInputFailure = z.infer<typeof imageInputFailureSchema>;
export const imageChannelCoverageSchema = z
  .object({
    total: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
    deferred: z.number().int().nonnegative(),
    limited: z.number().int().nonnegative(),
    reasons: z.array(z.object({ reason: imageInputReasonSchema, count: z.number().int().positive() })),
  })
  .strict();
export const imageSearchChannelsSchema = z
  .object({
    visual: imageChannelCoverageSchema,
    ocr: imageChannelCoverageSchema,
  })
  .strict();
export const imageIssueInputSchema = z
  .object({
    requestId: z.string().uuid(),
    channel: z.enum(['visual', 'ocr']),
    after: z.string().max(200).default(''),
    snapshot: z.string().max(200).optional(),
  })
  .strict();
export const imageIssueResultSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            failure: imageInputFailureSchema.nullable(),
            limited: z.boolean(),
          })
          .strict(),
      )
      .max(30),
    next: z.string().nullable(),
    snapshot: z.string(),
    reset: z.boolean(),
  })
  .strict();
export type ImageIssueInput = z.infer<typeof imageIssueInputSchema>;
export type ImageIssueResult = z.infer<typeof imageIssueResultSchema>;
