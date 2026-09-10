import { z } from 'zod';
import {
  gifMotionPlanSchema,
  gifMotionRegionSchema,
  gifFrameGenerationModeSchema,
  gifReturnModeSchema,
} from '@/shared/contracts/gif-motion-plan';

// Drafts allow unfinished plan text; generation still requires the confirmed plan schema.
export const gifMotionDraftSchema = z
  .object({
    prompt: z.string().max(4000),
    mode: z.enum(['WHOLE', 'REGION']),
    region: gifMotionRegionSchema.nullable(),
    feather: z.number().min(0).max(0.4),
    durationMs: z.number().int().min(400).max(10000).multipleOf(10),
    modelKey: z.string().max(200),
    quality: z.enum(['low', 'medium', 'high']),
    generationMode: gifFrameGenerationModeSchema.default('SHEET'),
    returnMode: gifReturnModeSchema.default('CONTINUE'),
    plan: z
      .object({
        ...gifMotionPlanSchema.shape,
        title: z.string().max(120),
        subject: z.string().max(300),
        preserve: z.string().max(600),
        states: z.array(z.string().max(400)).max(8),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type GifMotionDraft = z.infer<typeof gifMotionDraftSchema>;
export const gifDocumentPurposeSchema = z.enum(['GIF', 'MOTION']);
export type GifDocumentPurpose = z.infer<typeof gifDocumentPurposeSchema>;
