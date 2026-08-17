import { z } from 'zod';
import {
  localQwenAsrProviderKeySchema,
  videoDocumentGenerationRunSchema,
  videoDocumentTranscriptRecognitionErrorCodeSchema,
  videoDocumentTranscriptRecognitionOperationIdSchema,
} from '@/shared/contracts/video-document';
import { videoDocumentTranscriptTranslationRunSchema } from '@/shared/contracts/video-document-translation';

export const videoDocumentTranscriptionRunStatusSchema = z.enum([
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
  'NOT_STARTED',
]);

export const videoDocumentTranscriptionRunSchema = z
  .object({
    id: videoDocumentTranscriptRecognitionOperationIdSchema,
    documentId: z.string().min(1).max(200),
    outputRevisionId: z.string().min(1).max(200).nullable(),
    status: videoDocumentTranscriptionRunStatusSchema,
    providerKey: localQwenAsrProviderKeySchema,
    modelId: z.literal('Qwen/Qwen3-ASR-0.6B'),
    completedChunks: z.number().int().nonnegative(),
    totalChunks: z.number().int().positive().nullable(),
    errorCode: videoDocumentTranscriptRecognitionErrorCodeSchema.nullable(),
    retryable: z.boolean().nullable(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.totalChunks !== null && run.completedChunks > run.totalChunks) {
      context.addIssue({
        code: 'custom',
        message: 'Completed transcript chunks cannot exceed the total',
        path: ['completedChunks'],
      });
    }
  });

const videoDocumentAiActivitySourceSchema = {
  documentTitle: z.string().trim().min(1).max(500),
  albumId: z.string().min(1).max(200).nullable(),
};

export const videoDocumentAiActivitySchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ARTICLE_GENERATION'),
      ...videoDocumentAiActivitySourceSchema,
      run: videoDocumentGenerationRunSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('TRANSCRIPT_RECOGNITION'),
      ...videoDocumentAiActivitySourceSchema,
      run: videoDocumentTranscriptionRunSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('TRANSCRIPT_TRANSLATION'),
      ...videoDocumentAiActivitySourceSchema,
      run: videoDocumentTranscriptTranslationRunSchema,
    })
    .strict(),
]);

export const videoDocumentAiActivitiesListInputSchema = z
  .object({
    cursor: z.string().max(1_000).nullable().default(null),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();

export const videoDocumentAiActivitiesPageSchema = z
  .object({
    items: z.array(videoDocumentAiActivitySchema),
    nextCursor: z.string().max(1_000).nullable(),
  })
  .strict();

export type VideoDocumentTranscriptionRunDto = z.infer<typeof videoDocumentTranscriptionRunSchema>;
export type VideoDocumentAiActivityDto = z.infer<typeof videoDocumentAiActivitySchema>;
export type VideoDocumentAiActivitiesListInput = z.input<typeof videoDocumentAiActivitiesListInputSchema>;
export type VideoDocumentAiActivitiesPage = z.infer<typeof videoDocumentAiActivitiesPageSchema>;
