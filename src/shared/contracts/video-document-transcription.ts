import { z } from 'zod';
import {
  localQwenAsrProviderKeySchema,
  videoDocumentTranscriptRecognitionErrorCodeSchema,
  videoDocumentTranscriptRecognitionOperationIdSchema,
} from '@/shared/contracts/video-document';

export const videoDocumentTranscriptBackgroundTaskStatusSchema = z.enum(['STARTING', 'TRANSCRIBING', 'CANCELLING']);

export const videoDocumentTranscriptBackgroundTaskSchema = z
  .object({
    operationId: videoDocumentTranscriptRecognitionOperationIdSchema,
    documentId: z.string().min(1).max(200),
    documentTitle: z.string().trim().min(1).max(500),
    providerKey: localQwenAsrProviderKeySchema,
    modelId: z.literal('Qwen/Qwen3-ASR-0.6B'),
    status: videoDocumentTranscriptBackgroundTaskStatusSchema,
    completedChunks: z.number().int().nonnegative(),
    totalChunks: z.number().int().positive().nullable(),
    startedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.totalChunks !== null && task.completedChunks > task.totalChunks) {
      context.addIssue({
        code: 'custom',
        message: 'Completed transcript chunks cannot exceed the total',
        path: ['completedChunks'],
      });
    }
  });

export const videoDocumentTranscriptBackgroundTaskTerminalSchema = z.discriminatedUnion('status', [
  z
    .object({
      operationId: videoDocumentTranscriptRecognitionOperationIdSchema,
      documentId: z.string().min(1).max(200),
      status: z.literal('succeeded'),
      finishedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      operationId: videoDocumentTranscriptRecognitionOperationIdSchema,
      documentId: z.string().min(1).max(200),
      status: z.literal('failed'),
      code: videoDocumentTranscriptRecognitionErrorCodeSchema,
      retryable: z.boolean(),
      finishedAt: z.string().datetime(),
    })
    .strict(),
]);

export const videoDocumentTranscriptBackgroundTaskSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    tasks: z.array(videoDocumentTranscriptBackgroundTaskSchema).max(20),
  })
  .strict();

export const videoDocumentTranscriptBackgroundTasksChangedEventSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    tasks: z.array(videoDocumentTranscriptBackgroundTaskSchema).max(20),
    terminal: videoDocumentTranscriptBackgroundTaskTerminalSchema.nullable(),
  })
  .strict();

export type VideoDocumentTranscriptBackgroundTaskStatus = z.infer<
  typeof videoDocumentTranscriptBackgroundTaskStatusSchema
>;
export type VideoDocumentTranscriptBackgroundTask = z.infer<typeof videoDocumentTranscriptBackgroundTaskSchema>;
export type VideoDocumentTranscriptBackgroundTaskTerminal = z.infer<
  typeof videoDocumentTranscriptBackgroundTaskTerminalSchema
>;
export type VideoDocumentTranscriptBackgroundTaskSnapshot = z.infer<
  typeof videoDocumentTranscriptBackgroundTaskSnapshotSchema
>;
export type VideoDocumentTranscriptBackgroundTasksChangedEvent = z.infer<
  typeof videoDocumentTranscriptBackgroundTasksChangedEventSchema
>;
