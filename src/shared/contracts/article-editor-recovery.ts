import { z } from 'zod';
import {
  articleCommentAnchorUpdateSchema,
  articleContentSchema,
  articleElementPlacementSchema,
} from '@/shared/contracts/article';
import { videoDocumentRevisionMediaSchema } from '@/shared/contracts/video-document';

export const ARTICLE_EDITOR_RECOVERY_MAX_CHECKPOINTS = 32;
export const ARTICLE_EDITOR_RECOVERY_MAXIMUM_BYTES = 64 * 1024 * 1024;

const storageIdentitySchema = z.string().min(1).max(200);
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const articleEditorRecoveryPendingSaveSchema = z
  .object({
    requestId: storageIdentitySchema,
    expectedRevisionId: storageIdentitySchema,
    contentHash: contentHashSchema,
  })
  .strict();

export const articleEditorRecoveryCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    spaceId: storageIdentitySchema,
    articleId: storageIdentitySchema,
    sessionEpoch: storageIdentitySchema,
    draftSeq: z.number().int().nonnegative(),
    baseRevisionId: storageIdentitySchema,
    baseContentHash: contentHashSchema,
    content: articleContentSchema,
    media: z.array(videoDocumentRevisionMediaSchema).max(100),
    elements: z.array(articleElementPlacementSchema).max(20_000),
    commentAnchors: z.array(articleCommentAnchorUpdateSchema).max(20_000).optional(),
    pendingSave: articleEditorRecoveryPendingSaveSchema.nullable(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const articleEditorRecoveryScopeSchema = z
  .object({
    spaceId: storageIdentitySchema,
    articleId: storageIdentitySchema,
  })
  .strict();

export const articleEditorRecoveryIdentitySchema = articleEditorRecoveryScopeSchema
  .extend({ sessionEpoch: storageIdentitySchema })
  .strict();

const recoveryErrorSchema = z
  .object({
    status: z.literal('error'),
    message: z.string().min(1).max(2_000),
  })
  .strict();

export const articleEditorRecoveryListResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ok'),
      checkpoints: z.array(articleEditorRecoveryCheckpointSchema).max(ARTICLE_EDITOR_RECOVERY_MAX_CHECKPOINTS),
    })
    .strict(),
  recoveryErrorSchema,
]);

export const articleEditorRecoveryMutationResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }).strict(),
  recoveryErrorSchema,
]);

export type ArticleEditorRecoveryCheckpoint = z.infer<typeof articleEditorRecoveryCheckpointSchema>;
export type ArticleEditorRecoveryScope = z.infer<typeof articleEditorRecoveryScopeSchema>;
export type ArticleEditorRecoveryIdentity = z.infer<typeof articleEditorRecoveryIdentitySchema>;
export type ArticleEditorRecoveryListResult = z.infer<typeof articleEditorRecoveryListResultSchema>;
export type ArticleEditorRecoveryMutationResult = z.infer<typeof articleEditorRecoveryMutationResultSchema>;
