import { z } from 'zod';

export const gifFrameGenerationModeSchema = z.enum(['FRAMES', 'SHEET']);
export const gifReturnModeSchema = z.enum(['CONTINUE', 'REVERSE', 'ONE_WAY']);

export const gifMotionRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.005).max(1),
    height: z.number().min(0.005).max(1),
  })
  .strict()
  .refine((r) => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001);
export type GifMotionRegion = z.infer<typeof gifMotionRegionSchema>;

export const gifMotionPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(300),
    preserve: z.string().trim().min(1).max(600),
    mode: z.enum(['WHOLE', 'REGION']),
    region: gifMotionRegionSchema.nullable(),
    states: z.array(z.string().trim().min(1).max(400)).min(4).max(8),
    returnMode: gifReturnModeSchema,
    durationMs: z.number().int().min(400).max(10000).multipleOf(10),
  })
  .strict()
  .superRefine((plan, context) => {
    if (
      (plan.mode === 'REGION' && !plan.region) ||
      new Set(plan.states.map((s) => s.toLowerCase())).size !== plan.states.length
    )
      context.addIssue({ code: 'custom', message: 'GIF_PLAN_INVALID' });
  });
export type GifMotionPlan = z.infer<typeof gifMotionPlanSchema>;
export const gifPlanRequestSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    sourceAssetId: z.string().min(1).max(200),
    prompt: z.string().trim().min(1).max(4000),
    locale: z.enum(['en', 'zh']),
    mode: z.enum(['WHOLE', 'REGION']),
    region: gifMotionRegionSchema.nullable(),
    returnMode: gifReturnModeSchema.optional(),
  })
  .strict();
export type GifPlanRequest = z.infer<typeof gifPlanRequestSchema>;
export interface GifPlanResult {
  plan: GifMotionPlan;
  model: string;
  threadId: string;
  turnId: string;
}
export const gifFrameAuditSchema = z
  .object({
    plannedStates: z.number().int().min(2).max(8),
    distinctStates: z.number().int().min(1).max(8),
    duplicateStates: z.array(z.number().int().min(1).max(7)).max(7),
  })
  .strict();
export type GifFrameAudit = z.infer<typeof gifFrameAuditSchema>;

export function gifPlanSequence(plan: Pick<GifMotionPlan, 'states' | 'returnMode'>) {
  const forward = plan.states.map((_, i) => i);
  // Looping returns to the first frame itself; do not append a second copy or a hold at the seam.
  return plan.returnMode === 'REVERSE' ? [...forward, ...forward.slice(1, -1).reverse()] : forward;
}
export function gifPlanTimings(plan: GifMotionPlan) {
  const sequence = gifPlanSequence(plan);
  const ticks = plan.durationMs / 10;
  const weights = sequence.map((state, i) => {
    if (plan.returnMode === 'CONTINUE') return 1;
    if (i === 0 || (plan.returnMode === 'ONE_WAY' && i === sequence.length - 1)) return 5;
    return state === plan.states.length - 1 ? 2 : 1;
  });
  const remaining = ticks - 2 * sequence.length;
  const weight = weights.reduce((a, b) => a + b, 0);
  const times = weights.map((w) => 2 + Math.floor((remaining * w) / weight));
  for (let left = ticks - times.reduce((a, b) => a + b, 0), i = 0; left > 0; left--, i++) times[i % times.length]++;
  return times.map((t) => t * 10);
}
