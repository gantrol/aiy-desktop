import { z } from 'zod';

export const packSyncItemSchema = z
  .object({
    packId: z.string().min(1),
    title: z.string().max(300),
    version: z.string(),
    status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED']),
  })
  .strict();

export const packSyncSummarySchema = z
  .object({
    runId: z.string().min(1),
    kind: z.enum(['BUILTIN', 'CONTENT_PACK']),
    status: z.enum(['SUCCEEDED', 'FAILED', 'INTERRUPTED']),
    packs: z.array(packSyncItemSchema).max(100),
  })
  .strict();

export type PackSyncItem = z.infer<typeof packSyncItemSchema>;
export type PackSyncSummary = z.infer<typeof packSyncSummarySchema>;
