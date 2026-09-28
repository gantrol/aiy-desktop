import { z } from 'zod';
import { browserCompanionInspectionSchema, companionSiteSchema, consumeHandoffErrorCodeSchema } from '@/lib/protocol';

export const currentHandoffRequestSchema = z
  .object({
    protocolVersion: z.literal(1),
    kind: z.enum(['inspect-current-handoff', 'retry-handoff-receipt']),
    requestId: z.string().uuid(),
    handoffId: z.string().uuid().optional(),
  })
  .strict();

export const currentHandoffSnapshotSchema = z
  .object({
    kind: z.literal('current-handoff'),
    site: companionSiteSchema.nullable(),
    state: z.enum([
      'waiting',
      'ready',
      'filling',
      'delivered',
      'receipt',
      'media',
      'failed',
      'empty',
      'offline',
      'unsupported',
      'unknown',
    ]),
    connection: z.enum(['connected', 'offline', 'unknown']),
    stage: z.enum([
      'idle',
      'connecting',
      'downloading',
      'waiting-editor',
      'waiting-confirmation',
      'writing',
      'uploading',
      'receipt',
    ]),
    code: z.union([consumeHandoffErrorCodeSchema, z.enum(['RECEIPT_PENDING', 'FILL_RESULT_UNKNOWN'])]).nullable(),
    task: browserCompanionInspectionSchema.nullable(),
    canRetryReceipt: z.boolean(),
    thumbnails: z
      .array(
        z
          .object({
            mediaId: z.string().uuid(),
            dataUrl: z
              .string()
              .max(40_000)
              .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type CurrentHandoffSnapshot = z.infer<typeof currentHandoffSnapshotSchema>;
export type HandoffFillStage = Extract<CurrentHandoffSnapshot['stage'], 'waiting-confirmation' | 'uploading'>;
export const COMPOSER_WAIT_MS = 20_000;
