import { z } from 'zod';

export const videoKeyChangeCandidateReasonSchema = z.enum(['SOURCE_START', 'SOURCE_END', 'VISUAL_CHANGE', 'COVERAGE']);

export const videoKeyChangeCandidateSchema = z
  .object({
    id: z.string().min(1).max(200),
    timestampMs: z.number().int().nonnegative(),
    score: z.number().finite().nonnegative(),
    reason: videoKeyChangeCandidateReasonSchema,
    imageUrl: z.string().min(1).max(1000),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const videoKeyChangeResultSchema = z
  .object({
    extractionId: z.string().regex(/^[a-f0-9]{64}$/),
    documentId: z.string().min(1).max(200),
    sourceAssetId: z.string().min(1).max(200),
    algorithmVersion: z.literal(1),
    durationMs: z.number().int().positive(),
    sampleIntervalMs: z.number().int().positive(),
    scannedFrameCount: z.number().int().positive(),
    candidates: z.array(videoKeyChangeCandidateSchema).min(1).max(24),
    createdAt: z.string().min(1).max(100),
  })
  .strict();

export const videoKeyChangeExtractInputSchema = z
  .object({
    documentId: z.string().min(1).max(200),
  })
  .strict();

export type VideoKeyChangeCandidateReason = z.infer<typeof videoKeyChangeCandidateReasonSchema>;
export type VideoKeyChangeCandidateDto = z.infer<typeof videoKeyChangeCandidateSchema>;
export type VideoKeyChangeResultDto = z.infer<typeof videoKeyChangeResultSchema>;
export type VideoKeyChangeExtractInput = z.infer<typeof videoKeyChangeExtractInputSchema>;
