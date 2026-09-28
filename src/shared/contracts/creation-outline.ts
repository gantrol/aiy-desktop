import { z } from 'zod';
import { creationFormEntityRefSchema } from '@/shared/contracts/creation-library';

export const CREATION_OUTLINE_BATCH_LIMIT = 200;
const id = z.string().min(1).max(200);
export const creationOutlineTargetSchema = z
  .object({
    kind: z.enum(['ALBUM', 'CREATION_ITEM']),
    id,
    expectedAlbumId: id.nullable(),
    expectedParentCreationItemId: id.nullable().optional(),
  })
  .strict();
export const creationOutlineCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('copy-form-owner'), entity: creationFormEntityRefSchema, albumId: id.nullable() })
    .strict(),
  z
    .object({
      kind: z.literal('copy'),
      targets: z
        .array(creationOutlineTargetSchema.extend({ expectedAlbumId: id.nullable().optional() }))
        .min(1)
        .max(CREATION_OUTLINE_BATCH_LIMIT),
      albumId: id.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('move'),
      targets: z.array(creationOutlineTargetSchema).min(1).max(CREATION_OUTLINE_BATCH_LIMIT),
      albumId: id.nullable(),
      parentCreationItemId: id.nullable().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('undo'), token: z.string().uuid() }).strict(),
]);
export const creationOutlineResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('copied'),
      count: z.number().int().nonnegative(),
      ids: z.array(id).max(CREATION_OUTLINE_BATCH_LIMIT),
    })
    .strict(),
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
