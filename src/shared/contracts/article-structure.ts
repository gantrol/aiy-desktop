import { z } from 'zod';

const id = z.string().min(1).max(200);
export const ARTICLE_STRUCTURE_PAGE_SIZE = 200;
export const articleStructureInputSchema = z
  .object({
    spaceId: id,
    articleId: id,
    offset: z.number().int().min(0).max(100_000).default(0),
    expectedRevisionId: id.optional(),
  })
  .strict();
export const articleStructureNodeSchema = z
  .object({
    blockId: id,
    parentBlockId: id.nullable(),
    kind: z.enum(['heading', 'item', 'paragraph', 'image', 'reference', 'link', 'table', 'code', 'quote', 'group']),
    title: z.string().max(180),
    assetId: id.optional(),
    referenceId: id.optional(),
  })
  .strict();
export const articleStructurePageSchema = z
  .object({
    spaceId: id,
    articleId: id,
    revisionId: id,
    nodes: z.array(articleStructureNodeSchema).max(ARTICLE_STRUCTURE_PAGE_SIZE),
    nextOffset: z.number().int().nullable(),
    legacy: z.boolean(),
  })
  .strict();
export type ArticleStructureInput = z.input<typeof articleStructureInputSchema>;
export type ArticleStructureNode = z.infer<typeof articleStructureNodeSchema>;
export type ArticleStructurePage = z.infer<typeof articleStructurePageSchema>;
