import { z } from 'zod';

const idSchema = z.string().min(1).max(200);
const articleMediaPathSchema = z
  .string()
  .min(1)
  .max(260)
  .regex(/^assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/u, 'Article media paths must stay inside assets/');

export const articleMediaBindingSchema = z
  .object({
    path: articleMediaPathSchema,
    assetId: idSchema,
  })
  .strict();

export const articleContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().max(200),
    markdown: z.string().max(1_000_000),
    mediaBindings: z.array(articleMediaBindingSchema).max(100),
    coverAssetId: idSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const paths = value.mediaBindings.map((binding) => binding.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: 'custom', path: ['mediaBindings'], message: 'Article media paths must be unique' });
    }
    const assetIds = value.mediaBindings.map((binding) => binding.assetId);
    if (new Set(assetIds).size !== assetIds.length) {
      context.addIssue({ code: 'custom', path: ['mediaBindings'], message: 'Article media assets must be unique' });
    }
    if (value.coverAssetId && !assetIds.includes(value.coverAssetId)) {
      context.addIssue({ code: 'custom', path: ['coverAssetId'], message: 'The cover must be article media' });
    }
  });

export const articleSaveInputSchema = z
  .object({
    id: idSchema.nullable(),
    albumId: idSchema.nullable(),
    sourceInspirationStashId: idSchema.nullable(),
    consumeCreationDraftId: idSchema.nullable(),
    content: articleContentSchema,
  })
  .strict();

export const articleFormAddInputSchema = z
  .object({
    creationItemId: idSchema,
    sourceInspirationStashId: idSchema.nullable(),
    consumeCreationDraftId: idSchema.nullable(),
    content: articleContentSchema,
  })
  .strict();

export const articleMoveInputSchema = z.object({ id: idSchema, albumId: idSchema.nullable() }).strict();
export const articleRenameInputSchema = z.object({ id: idSchema, title: z.string().trim().min(1).max(200) }).strict();
export const articleSetArchivedInputSchema = z.object({ id: idSchema, archived: z.boolean() }).strict();
export const articleCopyForWechatInputSchema = z.object({ id: idSchema }).strict();
export const articleCopyForWechatResultSchema = z
  .object({
    embeddedImageCount: z.number().int().nonnegative(),
    remoteImageCount: z.number().int().nonnegative(),
  })
  .strict();
export const articleExportMarkdownInputSchema = z.object({ id: idSchema }).strict();
export const articleExportMarkdownResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('SAVED'), filePath: z.string().min(1) }).strict(),
  z.object({ status: z.literal('CANCELLED') }).strict(),
]);

export type ArticleMediaBindingInput = z.infer<typeof articleMediaBindingSchema>;
export type ArticleContentInput = z.infer<typeof articleContentSchema>;
export type ArticleSaveInput = z.infer<typeof articleSaveInputSchema>;
export type ArticleFormAddInput = z.infer<typeof articleFormAddInputSchema>;
export type ArticleMoveInput = z.infer<typeof articleMoveInputSchema>;
export type ArticleRenameInput = z.infer<typeof articleRenameInputSchema>;
export type ArticleSetArchivedInput = z.infer<typeof articleSetArchivedInputSchema>;
export type ArticleCopyForWechatInput = z.infer<typeof articleCopyForWechatInputSchema>;
export type ArticleCopyForWechatResult = z.infer<typeof articleCopyForWechatResultSchema>;
export type ArticleExportMarkdownInput = z.infer<typeof articleExportMarkdownInputSchema>;
