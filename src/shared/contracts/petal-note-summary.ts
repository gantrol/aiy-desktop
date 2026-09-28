import { z } from 'zod';
import { petalColorSchema, petalIconSchema } from '@/shared/contracts/petal-appearance';

/** Desktop presentation has no document, revision tree or editor state. */
export const petalNoteSummarySchema = z
  .object({
    id: z.string(),
    stashId: z.string(),
    title: z.string(),
    color: petalColorSchema,
    icon: petalIconSchema,
    hasImages: z.boolean(),
    persisted: z.boolean(),
  })
  .strict();
export type PetalNoteSummary = z.infer<typeof petalNoteSummarySchema>;
