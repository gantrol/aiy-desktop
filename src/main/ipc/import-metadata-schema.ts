import { z } from 'zod';

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => !value || /^https?:\/\//i.test(value), { message: 'Source must be an HTTP(S) URL' });

export const importedImageMetadataSchema = z
  .object({
    displayName: z.string().trim().min(1).max(500),
    note: z.string().max(4000),
    sourceUrl: httpUrl,
    aiGeneratedStatus: z.enum(['YES', 'NO', 'UNKNOWN', 'OTHER']),
    modelKey: z.string().min(1).max(100).nullable(),
    modelName: z.string().max(300),
    modelProvider: z.string().max(200),
    modelVersion: z.string().max(200),
    generationTextType: z.enum(['EXACT_PROMPT', 'DESCRIPTION', 'RECONSTRUCTION', 'UNKNOWN']),
    generationText: z.string().max(30_000),
  })
  .strict();

export const importedImageRelationshipSchema = z
  .object({
    seriesId: z.string().min(1).max(200),
    promptVersionId: z.string().min(1).max(200).nullable(),
  })
  .strict();
