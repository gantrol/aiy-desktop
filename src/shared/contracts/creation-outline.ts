import { z } from 'zod';

export const CREATION_OUTLINE_BATCH_LIMIT = 200;
const id = z.string().min(1).max(200);
export const creationOutlineTargetSchema = z
  .object({
    kind: z.enum(['ALBUM', 'CREATION_ITEM']),
    id,
    expectedAlbumId: id.nullable(),
  })
  .strict();
export const creationOutlineCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('move'),
      targets: z.array(creationOutlineTargetSchema).min(1).max(CREATION_OUTLINE_BATCH_LIMIT),
      albumId: id.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('undo'), token: z.string().uuid() }).strict(),
]);
export const creationOutlineResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('moved'),
      count: z.number().int().nonnegative(),
      undoToken: z.string().uuid().nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('undone'), count: z.number().int().nonnegative() }).strict(),
  z
    .object({
      kind: z.literal('error'),
      code: z.enum(['CHANGED', 'UNAVAILABLE', 'INVALID_DESTINATION', 'BUSY', 'FAILED']),
    })
    .strict(),
]);
export type CreationOutlineTarget = z.infer<typeof creationOutlineTargetSchema>;
export type CreationOutlineCommand = z.infer<typeof creationOutlineCommandSchema>;
export type CreationOutlineResult = z.infer<typeof creationOutlineResultSchema>;
