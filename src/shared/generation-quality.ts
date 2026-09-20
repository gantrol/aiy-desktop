import { z } from 'zod';

export const generationQualityValues = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const generationQualitySchema = z.enum(generationQualityValues);
export type GenerationQuality = z.infer<typeof generationQualitySchema>;
