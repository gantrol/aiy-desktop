import { z } from 'zod';
import { contentSourceSchema } from '@/shared/contracts/content-source';

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/u);
export const contentLinkTargetSchema = z
  .object({ kind: z.enum(['ARTICLE', 'ALBUM']), id, blockId: id.optional() })
  .strict()
  .refine((target) => !target.blockId || target.kind === 'ARTICLE', 'BLOCK_SCOPE_UNSUPPORTED');
export const contentLinkInputSchema = z.object({ spaceId: id, target: contentLinkTargetSchema }).strict();
export const contentLinkResultSchema = contentLinkInputSchema.extend({ title: z.string(), url: z.string() }).strict();
export type ContentLinkInput = z.infer<typeof contentLinkInputSchema>;
export type ContentLinkResult = z.infer<typeof contentLinkResultSchema>;

export const outlineLinkedCreateInputSchema = z
  .object({
    spaceId: id,
    requestId: z.string().uuid(),
    sourceArticleId: id,
    sourceBlockId: id,
    expectedRevisionId: id,
    title: z.string().trim().min(1).max(200),
    format: z.enum(['MANUSCRIPT', 'OUTLINE']),
    albumId: id.nullable(),
  })
  .strict();
export type OutlineLinkedCreateInput = z.infer<typeof outlineLinkedCreateInputSchema>;

export const contentLinkUsesSchema = z
  .object({
    scope: z.literal('CURRENT_ARTICLES'),
    items: z
      .array(
        z
          .object({
            source: contentSourceSchema,
            title: z.string(),
            blockId: id.nullable(),
            preview: z.string(),
          })
          .strict(),
      )
      .max(1000),
    nextOffset: z.number().int().nonnegative().nullable(),
    unavailable: z.number().int().nonnegative(),
  })
  .strict();
export type ContentLinkUses = z.infer<typeof contentLinkUsesSchema>;

export function contentLinkUrl(input: ContentLinkInput) {
  const value = contentLinkInputSchema.parse(input);
  return `aiy://open/space/${value.spaceId}/${value.target.kind === 'ARTICLE' ? 'article' : 'album'}/${value.target.id}${value.target.blockId ? `/block/${value.target.blockId}` : ''}`;
}
