import { z } from 'zod';

const id = z.string().min(1).max(200);
export const publishingMaskSourceSchema = z.object({ kind: z.enum(['ARTICLE', 'SOCIAL_POST']), id }).strict();
export const publishingMaskTargetSchema = z
  .object({
    platform: z.enum(['wechat', 'xiaohongshu', 'weibo', 'x']),
    format: z.enum(['inline-article', 'numbered-gallery']),
  })
  .strict()
  .refine((value) => value.format !== 'inline-article' || value.platform === 'wechat');

function override<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('INHERIT') }).strict(),
    z.object({ mode: z.literal('CUSTOM'), value }).strict(),
    z.object({ mode: z.literal('CLEAR') }).strict(),
  ]);
}

export const publishingMaskOverridesSchema = z
  .object({
    title: override(z.string().max(200)),
    cover: override(id),
    // Null follows source order. An explicit empty order remains a deliberate choice.
    mediaOrder: z
      .array(id)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length)
      .nullable(),
  })
  .strict();

export const publishingMaskDraftSchema = z
  .object({
    id,
    version: z.number().int().positive(),
    source: publishingMaskSourceSchema,
    target: publishingMaskTargetSchema,
    ruleVersion: z.literal(1),
    sourceRevisionId: id,
    overrides: publishingMaskOverridesSchema,
    updatedAt: z.string(),
  })
  .strict();

export const publishingMaskScopeSchema = z
  .object({
    expectedSpaceId: id,
    source: publishingMaskSourceSchema,
    target: publishingMaskTargetSchema,
    expectedSourceRevisionId: id.optional(),
  })
  .strict();

export const publishingMaskSourceViewSchema = z.object({
  revisionId: id,
  title: z.string(),
  coverAssetId: id.nullable(),
  media: z.array(z.object({ id, mediaUrl: z.string() })).max(1000),
});
export const publishingMaskReadResultSchema = z.object({
  draft: publishingMaskDraftSchema.nullable(),
  source: publishingMaskSourceViewSchema,
});

export const publishingMaskSaveInputSchema = publishingMaskScopeSchema
  .extend({
    expectedVersion: z.number().int().positive().nullable(),
    sourceRevisionId: id,
    overrides: publishingMaskOverridesSchema,
  })
  .superRefine((input, context) => {
    if (!publishingMaskSupportsTitle(input.target) && input.overrides.title.mode !== 'INHERIT')
      context.addIssue({
        code: 'custom',
        path: ['overrides', 'title'],
        message: 'This platform does not accept a separate title',
      });
    if (input.target.format === 'inline-article' && input.overrides.mediaOrder !== null)
      context.addIssue({
        code: 'custom',
        path: ['overrides', 'mediaOrder'],
        message: 'Inline placements follow the manuscript',
      });
    if (input.target.format === 'numbered-gallery' && input.overrides.cover.mode !== 'INHERIT')
      context.addIssue({
        code: 'custom',
        path: ['overrides', 'cover'],
        message: 'A gallery uses its explicit attachment order',
      });
  });

export const publishingMaskErrorSchema = z.enum([
  'PUBLISHING_MASK_SPACE_CHANGED',
  'PUBLISHING_MASK_SOURCE_CHANGED',
  'PUBLISHING_MASK_CONFLICT',
  'PUBLISHING_MASK_MEDIA_CHANGED',
  'PUBLISHING_MASK_UNAVAILABLE',
]);
export type PublishingMaskSource = z.infer<typeof publishingMaskSourceSchema>;
export type PublishingMaskTarget = z.infer<typeof publishingMaskTargetSchema>;
export type PublishingMaskOverrides = z.infer<typeof publishingMaskOverridesSchema>;
export type PublishingMaskDraft = z.infer<typeof publishingMaskDraftSchema>;
export type PublishingMaskScope = z.infer<typeof publishingMaskScopeSchema>;
export type PublishingMaskReadResult = z.infer<typeof publishingMaskReadResultSchema>;
export type PublishingMaskSaveInput = z.infer<typeof publishingMaskSaveInputSchema>;

export interface PublishingMasksApi {
  get(input: PublishingMaskScope): Promise<PublishingMaskDraft | null>;
  read(input: PublishingMaskScope): Promise<PublishingMaskReadResult>;
  save(input: PublishingMaskSaveInput): Promise<PublishingMaskDraft>;
}

export function publishingMaskTarget(
  platform: PublishingMaskTarget['platform'],
  mode: 'article' | 'images',
): PublishingMaskTarget {
  return { platform, format: platform === 'wechat' && mode === 'article' ? 'inline-article' : 'numbered-gallery' };
}

export function inheritedPublishingMask(): PublishingMaskOverrides {
  return { title: { mode: 'INHERIT' }, cover: { mode: 'INHERIT' }, mediaOrder: null };
}

export function publishingMaskSupportsTitle(target: PublishingMaskTarget): boolean {
  return target.platform === 'wechat' || target.platform === 'xiaohongshu';
}

/** Early drafts may contain a title that their platform never accepted. */
export function publishingMaskOverridesForTarget(
  target: PublishingMaskTarget,
  overrides: PublishingMaskOverrides,
): PublishingMaskOverrides {
  return publishingMaskSupportsTitle(target) ? overrides : { ...overrides, title: { mode: 'INHERIT' } };
}

export function publishingMaskFields(
  source: { title: string; coverAssetId: string | null },
  overrides: PublishingMaskOverrides | undefined,
) {
  return {
    title:
      overrides?.title.mode === 'CLEAR'
        ? ''
        : overrides?.title.mode === 'CUSTOM'
          ? overrides.title.value
          : source.title,
    coverAssetId:
      overrides?.cover.mode === 'CLEAR'
        ? null
        : overrides?.cover.mode === 'CUSTOM'
          ? overrides.cover.value
          : source.coverAssetId,
  };
}

/** Explicit ordering never deletes new source media or silently revives a removed image. */
export function publishingMaskMediaOrder(source: readonly string[], preferred: readonly string[] | null | undefined) {
  if (!preferred) return [...source];
  if (preferred.some((id) => !source.includes(id))) throw new Error('PUBLISHING_MASK_MEDIA_CHANGED');
  return [...preferred, ...source.filter((id) => !preferred.includes(id))];
}
