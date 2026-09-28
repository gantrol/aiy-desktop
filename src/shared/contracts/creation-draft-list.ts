import { z } from 'zod';

const id = z.string().min(1).max(200);
const cursor = z.object({ updatedAt: z.string().min(1).max(100), id }).strict();

export const creationDraftListInputSchema = z
  .object({
    spaceId: id,
    query: z.string().trim().max(300),
    cursor: cursor.nullable(),
    limit: z.number().int().min(1).max(100),
  })
  .strict();

export const creationDraftSummarySchema = z
  .object({
    id,
    title: z.string().max(300),
    preview: z.string().max(160),
    targetAlbumId: id.nullable(),
    updatedAt: z.string().min(1).max(100),
  })
  .strict();

export const creationDraftListResultSchema = z
  .object({
    items: z.array(creationDraftSummarySchema).max(100),
    nextCursor: cursor.nullable(),
  })
  .strict();

export const creationDraftsChangedSchema = z.object({ spaceId: id }).strict();

export type CreationDraftListInput = z.infer<typeof creationDraftListInputSchema>;
export type CreationDraftListResult = z.infer<typeof creationDraftListResultSchema>;
export type CreationDraftSummary = z.infer<typeof creationDraftSummarySchema>;
export type CreationDraftsChanged = z.infer<typeof creationDraftsChangedSchema>;
