import { z } from 'zod';
const id = z.string().min(1).max(200);
export const referenceScopeSchema = z.enum(['SELF', 'SUBTREE', 'SECTION']);
export type ReferenceScope = z.infer<typeof referenceScopeSchema>;
/** Editable document identity remains separate from collection and workspace identities. */
export const contentSourceSchema = z
  .object({
    kind: z.enum(['ARTICLE', 'SOCIAL_POST', 'INSPIRATION_STASH', 'VIDEO_DOCUMENT']),
    id,
    branchId: id.optional(),
    noteId: id.optional(),
    revisionId: id.optional(),
  })
  .strict();
export type ContentSource = z.infer<typeof contentSourceSchema>;
export const collectionSourceSchema = z.object({ kind: z.enum(['CREATION_ITEM', 'ALBUM']), id }).strict();
export const referenceSourceSchema = z.union([contentSourceSchema, collectionSourceSchema]);
export type ReferenceSource = z.infer<typeof referenceSourceSchema>;
export function isDocumentSource(source: ReferenceSource): source is ContentSource {
  return source.kind !== 'CREATION_ITEM' && source.kind !== 'ALBUM';
}
export const referenceTargetSchema = z
  .object({
    source: referenceSourceSchema,
    blockId: id.optional(),
    section: z.boolean().optional(),
    scope: referenceScopeSchema.optional(),
  })
  .strict()
  .refine(
    (target) =>
      (!target.blockId || isDocumentSource(target.source)) &&
      (!(target.section || target.scope) || Boolean(target.blockId)) &&
      !(target.section && target.scope && target.scope !== 'SECTION'),
    'BLOCK_SCOPE_UNSUPPORTED',
  );
export type ReferenceTarget = z.infer<typeof referenceTargetSchema>;
export const referenceMemberSchema = z
  .object({
    membershipId: id,
    kind: z.string().min(1).max(100),
    id,
    title: z.string().max(1000),
    revisionId: id.optional(),
  })
  .strict();
export const referenceSelectorSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('BLOCK'), blockId: id, section: z.boolean(), scope: referenceScopeSchema.optional() })
    .strict(),
  z.object({ kind: z.literal('MEMBERS'), members: z.array(referenceMemberSchema).max(1000) }).strict(),
]);
