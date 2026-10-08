import { z } from 'zod';

/** Explicit continuation of an input or an existing output, independent of album placement. */
export const creationSourceSchema = z
  .object({
    kind: z.enum(['DRAFT', 'FORM']),
    id: z.string().min(1).max(200),
  })
  .strict();
export type CreationSource = z.infer<typeof creationSourceSchema>;
