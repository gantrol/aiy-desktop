import { z } from 'zod';

const idSchema = z.string().min(1).max(200);

export const socialPostContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().max(200),
    body: z.string().max(100_000),
    mediaAssetIds: z.array(idSchema).max(100),
    coverAssetId: idSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.mediaAssetIds).size !== value.mediaAssetIds.length) {
      context.addIssue({ code: 'custom', path: ['mediaAssetIds'], message: 'Post images must be unique' });
    }
    if (value.coverAssetId && !value.mediaAssetIds.includes(value.coverAssetId)) {
      context.addIssue({ code: 'custom', path: ['coverAssetId'], message: 'The cover must be one of the post images' });
    }
  });

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
      mediaAssetIds: value.mediaAssetIds,
      coverAssetId: value.coverAssetId,
    }),
  );

export const socialPostSaveInputSchema = z
  .object({
    id: idSchema.nullable(),
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
export type SocialPostSetArchivedInput = z.infer<typeof socialPostSetArchivedInputSchema>;
export type SocialPostMoveInput = z.infer<typeof socialPostMoveInputSchema>;
