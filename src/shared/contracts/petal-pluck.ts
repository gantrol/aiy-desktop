import { z } from 'zod';

export const petalPluckPointerSchema = z
  .object({
    token: z.string().uuid(),
    point: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    released: z.boolean(),
    cancelled: z.boolean().default(false),
  })
  .strict();
export type PetalPluckPointer = z.infer<typeof petalPluckPointerSchema>;
