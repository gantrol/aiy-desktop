import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import type { SocialPostDto } from '@/shared/contracts';
import { blockDocumentAssetIds, blockDocumentSchema } from '@/shared/contracts/block-document';
import { z } from 'zod';

const idSchema = z.string().min(1).max(200);

export const socialPostContentSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    title: z.string().max(200),
    body: z.string().max(100_000).optional(),
    format: z.literal('markdown').optional(),
    document: blockDocumentSchema.optional(),
    mediaAssetIds: z.array(idSchema).max(100),
    coverAssetId: idSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.schemaVersion === 1 && (value.body === undefined || value.document))
      context.addIssue({ code: 'custom', path: ['body'], message: 'SOCIAL_POST_LEGACY_CONTENT_INVALID' });
    if (value.schemaVersion === 2 && !value.document)
      context.addIssue({ code: 'custom', path: ['document'], message: 'BLOCK_DOCUMENT_REQUIRED' });
    if (value.document && blockDocumentAssetIds(value.document).some((id) => !value.mediaAssetIds.includes(id)))
      context.addIssue({ code: 'custom', path: ['mediaAssetIds'], message: 'BLOCK_DOCUMENT_MEDIA_MISSING' });
    if (new Set(value.mediaAssetIds).size !== value.mediaAssetIds.length) {
      context.addIssue({ code: 'custom', path: ['mediaAssetIds'], message: 'Post images must be unique' });
    }
    if (value.coverAssetId && !value.mediaAssetIds.includes(value.coverAssetId)) {
      context.addIssue({ code: 'custom', path: ['coverAssetId'], message: 'The cover must be one of the post images' });
    }
  })
  .transform((value) => ({
    ...value,
    body: value.document ? blockDocumentMarkdown(value.document) : value.body!,
    ...(value.document ? { format: 'markdown' as const } : {}),
  }));

const legacySocialPostContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().max(200),
    body: z.string().max(100_000),
    intent: z.enum(['SHARE', 'NOTE', 'PROMOTION']),
    platforms: z.array(z.enum(['WEIBO', 'WECHAT', 'XIAOHONGSHU'])).max(20),
    mediaAssetIds: z.array(idSchema).max(100),
    coverAssetId: idSchema.nullable(),
  })
  .strict();

/** Reads short-lived development revisions written before delivery settings
 * moved out of the post's core content. New writes always use the core schema. */
export const socialPostStoredContentSchema = z
  .union([socialPostContentSchema, legacySocialPostContentSchema])
  .transform((value) =>
    socialPostContentSchema.parse({
      schemaVersion: value.schemaVersion,
      title: value.title,
      body: value.body,
      ...('format' in value && value.format ? { format: value.format } : {}),
      ...('document' in value && value.document ? { document: value.document } : {}),
      mediaAssetIds: value.mediaAssetIds,
      coverAssetId: value.coverAssetId,
    }),
  );

export const socialPostSaveInputSchema = z
  .object({
    id: idSchema.nullable(),
    expectedRevisionId: idSchema.optional(),
    albumId: idSchema.nullable(),
    sourceInspirationStashId: idSchema.nullable(),
    consumeCreationDraftId: idSchema.nullable(),
    content: socialPostContentSchema,
  })
  .strict();

export const socialPostFormAddInputSchema = z
  .object({
    creationItemId: idSchema,
    sourceInspirationStashId: idSchema.nullable(),
    consumeCreationDraftId: idSchema.nullable(),
    content: socialPostContentSchema,
  })
  .strict();

export const socialPostFormCreateInputSchema = z
  .object({
    sourceFormId: idSchema,
    sourceInspirationStashId: idSchema.nullable(),
    content: socialPostContentSchema,
  })
  .strict();

export const socialPostSetArchivedInputSchema = z
  .object({
    id: idSchema,
    archived: z.boolean(),
  })
  .strict();

export const socialPostMoveInputSchema = z
  .object({
    id: idSchema,
    albumId: idSchema.nullable(),
  })
  .strict();

export type SocialPostContentInput = z.infer<typeof socialPostContentSchema>;
export type SocialPostSaveInput = z.infer<typeof socialPostSaveInputSchema>;
export type SocialPostFormAddInput = z.infer<typeof socialPostFormAddInputSchema>;
export type SocialPostFormCreateInput = z.infer<typeof socialPostFormCreateInputSchema>;
export type SocialPostSetArchivedInput = z.infer<typeof socialPostSetArchivedInputSchema>;
export type SocialPostMoveInput = z.infer<typeof socialPostMoveInputSchema>;

export function canonicalSocialPostContentJson(content: SocialPostContentInput) {
  const value = socialPostContentSchema.parse(content);
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    title: value.title,
    ...(value.document
      ? { document: value.document }
      : { body: value.body, ...(value.format ? { format: value.format } : {}) }),
    mediaAssetIds: value.mediaAssetIds,
    coverAssetId: value.coverAssetId,
  });
}

export const socialPostRevisionSaveInputSchema = z
  .object({
    postId: idSchema,
    expectedRevisionId: idSchema,
    requestId: idSchema,
    sessionEpoch: idSchema,
    draftSeq: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    content: socialPostContentSchema,
  })
  .strict();
export type SocialPostRevisionSaveInput = z.infer<typeof socialPostRevisionSaveInputSchema>;
type SocialPostSaveIdentity = Pick<SocialPostRevisionSaveInput, 'postId' | 'requestId' | 'sessionEpoch' | 'draftSeq'>;
export type SocialPostRevisionSaveResult = SocialPostSaveIdentity &
  (
    | { status: 'ACKNOWLEDGED'; contentHash: string; createdRevision: boolean; post: SocialPostDto }
    | { status: 'CONFLICT'; expectedRevisionId: string; currentPost: SocialPostDto }
  );
