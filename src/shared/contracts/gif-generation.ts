import { z } from 'zod';
import type { AssetDto, ImageGenerationRouteDto } from '@/shared/contracts';
import { gifIdSchema, gifManifestSchema, type GifDocumentDetail } from '@/shared/contracts/gif-making';
import {
  gifMotionRegionSchema,
  gifMotionPlanSchema,
  gifFrameGenerationModeSchema,
  type GifFrameAudit,
  type GifPlanRequest,
  type GifPlanResult,
} from '@/shared/contracts/gif-motion-plan';
export { gifMotionRegionSchema, type GifMotionRegion } from '@/shared/contracts/gif-motion-plan';

export const gifGenerationSettingsSchema = z
  .object({
    sourceAssetId: gifIdSchema,
    modelKey: gifIdSchema,
    prompt: z.string().trim().min(1).max(4000),
    mode: z.enum(['WHOLE', 'REGION']),
    region: gifMotionRegionSchema.nullable(),
    feather: z.number().min(0).max(0.4),
    keyframes: z.number().int().min(2).max(8),
    durationMs: z.number().int().min(400).max(10000).multipleOf(10),
    quality: z.enum(['low', 'medium', 'high']),
    // Previously saved generations used a single sheet.
    generationMode: gifFrameGenerationModeSchema.default('SHEET'),
    plan: gifMotionPlanSchema.optional(),
  })
  .strict()
  .refine((v) => v.mode !== 'REGION' || v.region !== null);
export type GifGenerationSettings = z.infer<typeof gifGenerationSettingsSchema>;
export const gifGenerationStartSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    titleLocale: z.enum(['en', 'zh']),
    settings: gifGenerationSettingsSchema,
  })
  .strict()
  .refine(
    (v) =>
      v.settings.plan &&
      v.settings.plan.states.length === v.settings.keyframes &&
      v.settings.plan.durationMs === v.settings.durationMs &&
      v.settings.plan.mode === v.settings.mode &&
      JSON.stringify(v.settings.plan.region) === JSON.stringify(v.settings.region),
    'GIF_PLAN_REQUIRED',
  );
export type GifGenerationStart = z.infer<typeof gifGenerationStartSchema>;
export const gifGenerationStates = [
  'PREPARING',
  'GENERATING',
  'COMPOSITING',
  'READY',
  'ADOPTED',
  'FAILED',
  'CANCELLED',
] as const;
export type GifGenerationState = (typeof gifGenerationStates)[number];
export interface GifGenerationCandidate {
  id: string;
  documentId: string;
  revision: number;
  settings: GifGenerationSettings;
  state: GifGenerationState;
  generationRunId: string | null;
  errorCode: string | null;
  providerMessage: string | null;
  manifest: z.infer<typeof gifManifestSchema> | null;
  assets: AssetDto[];
  createdAt: string;
  audit: GifFrameAudit | null;
}
export interface GifGenerationProgress {
  id: string;
  documentId: string;
  state: GifGenerationState;
  completedRequests?: number;
  totalRequests?: number;
}
export const gifGenerationAdoptSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type GifGenerationAdopt = z.infer<typeof gifGenerationAdoptSchema>;
export interface GifGenerationApi {
  gifPlan(input: GifPlanRequest): Promise<GifPlanResult>;
  gifGenerationRoutes(): Promise<ImageGenerationRouteDto[]>;
  gifGenerate(input: GifGenerationStart): Promise<GifGenerationCandidate>;
  gifGenerationLatest(documentId: string): Promise<GifGenerationCandidate | null>;
  gifGenerationHistory(documentId: string): Promise<GifGenerationCandidate[]>;
  gifGenerationCancel(id: string): Promise<void>;
  gifGenerationAdopt(input: GifGenerationAdopt): Promise<GifDocumentDetail>;
  onGifGenerationProgress(listener: (progress: GifGenerationProgress) => void): () => void;
}
