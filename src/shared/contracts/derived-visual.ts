import { z } from 'zod';

const idSchema = z.string().min(1).max(200);
const promptSchema = z.string().trim().min(1).max(30_000);
const canvasPresetKeySchema = z.string().min(1).max(100);
const localeSchema = z.enum(['zh', 'en']);
const workspaceTitleSchema = z.string().trim().min(1).max(300);

export const derivedVisualRoleSchema = z.enum(['ARTICLE_HEADER', 'ARTICLE_INLINE', 'SOCIAL_POST_COVER']);

export const articleInlineVisualAnchorSchema = z
  .object({
    selectedText: z.string().trim().min(1).max(12_000),
  })
  .strict();

const derivedVisualWorkspaceCreateInputSchema = z.discriminatedUnion('role', [
  z
    .object({
      mode: z.literal('CREATE'),
      role: z.literal('ARTICLE_HEADER'),
      workspaceTitle: workspaceTitleSchema,
      sourceFormId: idSchema,
      articleId: idSchema,
      articleRevisionId: idSchema,
      prompt: promptSchema,
      canvasPresetKey: canvasPresetKeySchema,
      locale: localeSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('CREATE'),
      role: z.literal('ARTICLE_INLINE'),
      workspaceTitle: workspaceTitleSchema,
      sourceFormId: idSchema,
      articleId: idSchema,
      articleRevisionId: idSchema,
      prompt: promptSchema,
      canvasPresetKey: canvasPresetKeySchema,
      locale: localeSchema,
      anchor: articleInlineVisualAnchorSchema,
      positionId: idSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('CREATE'),
      role: z.literal('SOCIAL_POST_COVER'),
      workspaceTitle: workspaceTitleSchema,
      sourceFormId: idSchema,
      socialPostId: idSchema,
      socialPostRevisionId: idSchema,
      prompt: promptSchema,
      canvasPresetKey: canvasPresetKeySchema,
      locale: localeSchema,
    })
    .strict(),
]);

const derivedVisualWorkspaceResumeInputSchema = z
  .object({
    mode: z.literal('RESUME'),
    visualId: idSchema,
  })
  .strict();

export const derivedVisualWorkspaceOpenInputSchema = z.union([
  derivedVisualWorkspaceCreateInputSchema,
  derivedVisualWorkspaceResumeInputSchema,
]);

export const derivedVisualAdoptInputSchema = z
  .object({
    id: idSchema,
    requestId: idSchema,
    spaceId: idSchema,
    imageAssetId: idSchema,
    expectedRevisionId: idSchema,
    intent: z.enum(['SET_COVER', 'SET_COVER_AND_FIRST', 'REPLACE_INLINE']),
    relocateAfterText: z.string().trim().min(1).max(12_000).optional(),
    imageAlt: z.string().max(280).optional(),
  })
  .strict();

export type DerivedVisualRole = z.infer<typeof derivedVisualRoleSchema>;
export type ArticleInlineVisualAnchor = z.infer<typeof articleInlineVisualAnchorSchema>;
export type DerivedVisualWorkspaceOpenInput = z.infer<typeof derivedVisualWorkspaceOpenInputSchema>;
export type DerivedVisualWorkspaceCreateInput = z.infer<typeof derivedVisualWorkspaceCreateInputSchema>;
export type DerivedVisualAdoptInput = z.infer<typeof derivedVisualAdoptInputSchema>;
