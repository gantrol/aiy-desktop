import { z } from 'zod';
import {
  videoDocumentGenerationErrorDetailsSchema,
  videoDocumentRevisionSchema,
  videoDocumentTokenAvailabilitySchema,
  videoDocumentTokenUsageSchema,
} from '@/shared/contracts/video-document';

export const videoDocumentTranslationLocaleSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (locale) => {
      try {
        return locale !== 'und' && Intl.getCanonicalLocales(locale)[0] === locale;
      } catch {
        return false;
      }
    },
    { message: 'Translation locales must be canonical BCP 47 language tags' },
  );

export const videoDocumentTranscriptTranslationOperationIdSchema = z.string().uuid();
export const videoDocumentTranscriptTranslationStatusSchema = z.enum([
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
  'NOT_STARTED',
]);

export const videoDocumentTranscriptTranslationStartInputSchema = z
  .object({
    operationId: videoDocumentTranscriptTranslationOperationIdSchema,
    documentId: z.string().min(1).max(200),
    targetLocales: z.array(videoDocumentTranslationLocaleSchema).min(1).max(5),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.targetLocales).size !== input.targetLocales.length) {
      context.addIssue({
        code: 'custom',
        message: 'Translation target locales must be unique',
        path: ['targetLocales'],
      });
    }
  });

export const videoDocumentTranscriptTranslationExecutionSchema = z
  .object({
    providerKey: z.literal('codex'),
    modelKey: z.string().trim().min(1).max(200),
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  })
  .strict();

export const videoDocumentTranscriptTranslationWorkerInputSchema =
  videoDocumentTranscriptTranslationStartInputSchema.extend({
    execution: videoDocumentTranscriptTranslationExecutionSchema,
  });

export const videoDocumentTranscriptTranslationRunSchema = z
  .object({
    id: videoDocumentTranscriptTranslationOperationIdSchema,
    documentId: z.string().min(1).max(200),
    branchId: z.string().min(1).max(200),
    inputRevisionId: z.string().min(1).max(200).nullable(),
    outputRevisionId: z.string().min(1).max(200).nullable(),
    targetLocales: z.array(videoDocumentTranslationLocaleSchema).min(1).max(5),
    status: videoDocumentTranscriptTranslationStatusSchema,
    providerKey: z.literal('codex'),
    requestedModel: z.string().min(1).max(200),
    actualModel: z.string().min(1).max(200).nullable(),
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
    completedBatches: z.number().int().nonnegative(),
    totalBatches: z.number().int().positive().nullable(),
    usageAvailability: videoDocumentTokenAvailabilitySchema,
    usage: videoDocumentTokenUsageSchema.nullable(),
    errorCode: z.string().min(1).max(100).nullable(),
    errorDetails: videoDocumentGenerationErrorDetailsSchema.nullable(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.totalBatches !== null && run.completedBatches > run.totalBatches) {
      context.addIssue({
        code: 'custom',
        message: 'Completed translation batches cannot exceed the total',
        path: ['completedBatches'],
      });
    }
  });

export const videoDocumentTranscriptTranslationResultSchema = z
  .object({
    run: videoDocumentTranscriptTranslationRunSchema,
    revision: videoDocumentRevisionSchema.nullable(),
  })
  .strict();

export type VideoDocumentTranslationLocale = z.infer<typeof videoDocumentTranslationLocaleSchema>;
export type VideoDocumentTranscriptTranslationStartInput = z.infer<
  typeof videoDocumentTranscriptTranslationStartInputSchema
>;
export type VideoDocumentTranscriptTranslationExecution = z.infer<
  typeof videoDocumentTranscriptTranslationExecutionSchema
>;
export type VideoDocumentTranscriptTranslationWorkerInput = z.infer<
  typeof videoDocumentTranscriptTranslationWorkerInputSchema
>;
export type VideoDocumentTranscriptTranslationRunDto = z.infer<typeof videoDocumentTranscriptTranslationRunSchema>;
export type VideoDocumentTranscriptTranslationResult = z.infer<typeof videoDocumentTranscriptTranslationResultSchema>;
