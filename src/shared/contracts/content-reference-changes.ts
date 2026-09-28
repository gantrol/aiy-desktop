import { z } from 'zod';

export const contentReferenceChangesSchema = z
  .object({
    spaceId: z.string().min(1).max(200),
    // Null invalidates source availability after an organization or media lifecycle change.
    articleIds: z.array(z.string().min(1).max(200)).max(256).nullable(),
  })
  .strict();
export type ContentReferenceChanges = z.infer<typeof contentReferenceChangesSchema>;
