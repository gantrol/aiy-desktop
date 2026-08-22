import { z } from 'zod';

/** Current terminal states defined by the Gemini Interactions API. */
export const googleInteractionStatusSchema = z.enum([
  'in_progress',
  'requires_action',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
  'budget_exceeded',
  'queued',
]);

export const googleInteractionErrorDetailSchema = z
  .object({
    message: z.string().max(10_000).optional(),
    code: z.union([z.string(), z.number()]).optional(),
    status: z.string().max(500).optional(),
  })
  .passthrough();
