import { z } from 'zod';

const id = z.string().min(1).max(200);

export const creationDraftDeleteInputSchema = z.object({ spaceId: id, draftId: id.nullable() }).strict();
export const creationDraftDeletionSchema = z
  .object({ spaceId: id, draftIds: z.array(id), deletedAt: z.string().datetime() })
  .strict();

export type CreationDraftDeleteInput = z.infer<typeof creationDraftDeleteInputSchema>;
export type CreationDraftDeletion = z.infer<typeof creationDraftDeletionSchema>;
