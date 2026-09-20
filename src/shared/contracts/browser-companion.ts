import { z } from 'zod';
import { naturalWatermarkProfileIdSchema } from '@/shared/contracts/natural-watermark';
import { XIAOHONGSHU_STAGE_ERROR_CODES } from '@/shared/xiaohongshu-publishing';

const idSchema = z.string().min(1).max(200);
const handoffIdSchema = z.string().uuid();
const chromeProfileDirectorySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => value !== '.' && value !== '..' && !/[\\/\u0000-\u001f]/.test(value));

export const browserCompanionTargetSchema = z.enum(['weibo', 'wechat', 'chatgpt', 'x', 'xiaohongshu']);
export const browserCompanionBrowserIdSchema = z.enum(['chrome', 'edge']);

export const browserCompanionSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('article'),
      id: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('social-post'),
      id: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('creation-draft'),
      id: idSchema,
      outputTarget: z
        .object({
          seriesId: idSchema,
          promptVersionId: idSchema,
        })
        .strict()
        .optional(),
    })
    .strict(),
]);

export const browserCompanionContentKindSchema = z.enum(['social-post-body', 'prompt', 'article-body']);
export const browserCompanionArticleHtmlSchema = z.string().min(1).max(256_000);
export const browserCompanionHandoffStateSchema = z.enum(['ready', 'claimed', 'delivered']);
export const browserCompanionWatermarkSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE') }).strict(),
  z.object({ kind: z.literal('PREFERRED') }).strict(),
  z
    .object({
      kind: z.literal('PROFILE'),
      profileId: naturalWatermarkProfileIdSchema,
    })
    .strict(),
]);

export const browserCompanionStageInputSchema = z
  .object({
    target: browserCompanionTargetSchema,
    source: browserCompanionSourceSchema,
    contentKind: browserCompanionContentKindSchema,
    title: z.string().trim().min(1).max(200).optional(),
    text: z.string().trim().min(1).max(10_000),
    articleHtml: browserCompanionArticleHtmlSchema.optional(),
    articleCoverMediaIndex: z.number().int().min(0).max(19).optional(),
    mediaAssetIds: z.array(idSchema).max(20).optional(),
    watermark: browserCompanionWatermarkSelectionSchema.optional(),
  })
  .strict()
  .refine((input) => input.target !== 'x' || (input.mediaAssetIds?.length ?? 0) <= 4, { path: ['mediaAssetIds'] })
  .refine((input) => input.target !== 'xiaohongshu' || input.contentKind === 'social-post-body', {
    path: ['contentKind'],
  })
  .refine(
    (input) =>
      input.articleCoverMediaIndex === undefined ||
      (input.contentKind === 'article-body' && input.articleCoverMediaIndex < (input.mediaAssetIds?.length ?? 0)),
    { path: ['articleCoverMediaIndex'] },
  )
  .refine(
    (input) =>
      input.contentKind === 'article-body'
        ? input.target === 'wechat' &&
          (input.source.kind === 'article' || input.source.kind === 'social-post') &&
          Boolean(input.title && input.articleHtml)
        : input.articleHtml === undefined,
    { path: ['articleHtml'] },
  );

export const browserCompanionHistoryItemSchema = z
  .object({
    handoffId: handoffIdSchema,
    batchId: z.string().uuid().optional(),
    target: browserCompanionTargetSchema,
    source: browserCompanionSourceSchema,
    contentKind: browserCompanionContentKindSchema,
    text: z.string().min(1).max(10_000),
    mediaCount: z.number().int().min(0).max(20),
    state: browserCompanionHandoffStateSchema,
    createdAt: z.string().datetime({ offset: true }),
    claimedAt: z.string().datetime({ offset: true }).nullable(),
    deliveredAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const browserCompanionStageResultSchema = z
  .object({
    handoff: browserCompanionHistoryItemSchema,
    browserOpened: z.boolean(),
    browserOpenError: z
      .enum([
        'BROWSER_NOT_FOUND',
        // Persisted CLI action receipts can still contain the Chrome-only v1 values.
        'CHROME_NOT_FOUND',
        'DESTINATION_NOT_SELECTED',
        'PROFILE_NOT_SELECTED',
        'PROFILE_UNAVAILABLE',
        'COMPANION_NOT_INSTALLED',
        'DESKTOP_SERVICE_UNAVAILABLE',
        'NATIVE_HOST_UNAVAILABLE',
        'LAUNCH_FAILED',
      ])
      .nullable(),
  })
  .strict();

export const browserCompanionStageErrorCodeSchema = z.enum([
  'X_MEDIA_UNSUPPORTED',
  'X_MEDIA_TOO_LARGE',
  ...XIAOHONGSHU_STAGE_ERROR_CODES,
]);

export const browserCompanionStageInvocationSchema = z.union([
  browserCompanionStageResultSchema,
  z.object({ errorCode: browserCompanionStageErrorCodeSchema }).strict(),
]);

export const browserCompanionBatchInputSchema = z
  .object({
    expectedSpaceId: idSchema.optional(),
    title: z.string().trim().min(1).max(80).optional(),
    items: z.array(browserCompanionStageInputSchema).min(1).max(4),
  })
  .strict()
  .superRefine((input, context) => {
    const source = input.items[0]?.source;
    const targets = new Set<BrowserCompanionTarget>();
    for (const [index, item] of input.items.entries()) {
      if (item.target === 'chatgpt' || item.contentKind === 'prompt') {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'target'],
          message: 'Publishing targets only',
        });
      }
      if (targets.has(item.target)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'target'],
          message: 'Duplicate publishing target',
        });
      }
      targets.add(item.target);
      if (!source || JSON.stringify(item.source) !== JSON.stringify(source)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'source'],
          message: 'Batch sources must match',
        });
      }
    }
  });

export const browserCompanionBatchItemResultSchema = z
  .object({
    target: browserCompanionTargetSchema.exclude(['chatgpt']),
    result: browserCompanionStageResultSchema.nullable(),
    errorCode: z
      .union([
        browserCompanionStageErrorCodeSchema,
        z.enum(['HANDOFF_NOT_ALLOWED', 'STAGE_FAILED', 'NOT_ATTEMPTED', 'OPEN_NOT_CONFIRMED']),
      ])
      .nullable(),
  })
  .strict()
  .refine(
    (item) =>
      item.result
        ? item.result.handoff.target === item.target &&
          (item.errorCode === null ||
            item.errorCode === 'HANDOFF_NOT_ALLOWED' ||
            item.errorCode === 'OPEN_NOT_CONFIRMED')
        : item.errorCode !== null && item.errorCode !== 'OPEN_NOT_CONFIRMED',
    {
      message: 'A batch item must describe a handoff or why it has not been prepared',
    },
  );

export const browserCompanionBatchResultSchema = z
  .object({
    batchId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    source: browserCompanionSourceSchema,
    items: z.array(browserCompanionBatchItemResultSchema).min(1).max(4),
  })
  .strict();

export const browserCompanionBatchHistoryResultSchema = z.array(browserCompanionBatchResultSchema).max(1_000);
export const browserCompanionReopenInputSchema = z
  .object({ handoffId: handoffIdSchema, expectedSpaceId: idSchema.optional() })
  .strict();
const browserCompanionScopeRejectedSchema = z
  .object({ errorCode: z.literal('BROWSER_COMPANION_LIBRARY_CHANGED') })
  .strict();
export const browserCompanionBatchInvocationSchema = z.union([
  browserCompanionBatchResultSchema,
  browserCompanionScopeRejectedSchema,
]);
export const browserCompanionReopenInvocationSchema = z.union([
  browserCompanionStageResultSchema,
  browserCompanionScopeRejectedSchema,
]);

export const browserCompanionOpenInputSchema = z
  .object({
    target: browserCompanionTargetSchema,
  })
  .strict();

export const browserCompanionOpenResultSchema = browserCompanionStageResultSchema
  .pick({ browserOpened: true, browserOpenError: true })
  .strict();

export const browserCompanionProfileSchema = z
  .object({
    directory: chromeProfileDirectorySchema,
    name: z.string().trim().min(1).max(100),
    companionInstalled: z.boolean(),
  })
  .strict();

export const browserCompanionBrowserSchema = z
  .object({
    id: browserCompanionBrowserIdSchema,
    name: z.string().trim().min(1).max(100),
    available: z.boolean(),
    profiles: z.array(browserCompanionProfileSchema).max(100),
  })
  .strict();

export const browserCompanionDestinationSchema = z
  .object({
    browserId: browserCompanionBrowserIdSchema,
    profileDirectory: chromeProfileDirectorySchema,
  })
  .strict();

const browserCompanionRoutesSchema = z
  .object({
    chatgpt: browserCompanionDestinationSchema.nullable(),
    wechat: browserCompanionDestinationSchema.nullable(),
    weibo: browserCompanionDestinationSchema.nullable(),
    x: browserCompanionDestinationSchema.nullable(),
    xiaohongshu: browserCompanionDestinationSchema.nullable(),
  })
  .strict();

export const browserCompanionDestinationsResultSchema = z
  .object({
    browsers: z.array(browserCompanionBrowserSchema).max(10),
    routes: browserCompanionRoutesSchema,
  })
  .strict();

export const browserCompanionDestinationSelectInputSchema = browserCompanionDestinationSchema
  .extend({
    target: browserCompanionTargetSchema,
  })
  .strict();

export const browserCompanionHistoryResultSchema = z.array(browserCompanionHistoryItemSchema).max(10_000);

export const browserCompanionBatchDeleteInputSchema = z
  .object({
    batchId: z.string().uuid(),
    targets: z
      .array(browserCompanionTargetSchema.exclude(['chatgpt']))
      .min(1)
      .max(4),
  })
  .strict();

export const browserCompanionDeleteInputSchema = z.union([
  z.object({ handoffIds: z.array(handoffIdSchema).min(1).max(500) }).strict(),
  browserCompanionBatchDeleteInputSchema,
]);

export const browserCompanionDeleteResultSchema = z
  .object({
    deletedHandoffIds: z.array(handoffIdSchema).max(500),
  })
  .strict();

export type BrowserCompanionTarget = z.infer<typeof browserCompanionTargetSchema>;
export type BrowserCompanionBrowserId = z.infer<typeof browserCompanionBrowserIdSchema>;
export type BrowserCompanionSource = z.infer<typeof browserCompanionSourceSchema>;
export type BrowserCompanionContentKind = z.infer<typeof browserCompanionContentKindSchema>;
export type BrowserCompanionHandoffState = z.infer<typeof browserCompanionHandoffStateSchema>;
export type BrowserCompanionWatermarkSelection = z.infer<typeof browserCompanionWatermarkSelectionSchema>;
export type BrowserCompanionStageInput = z.infer<typeof browserCompanionStageInputSchema>;
export type BrowserCompanionHistoryItem = z.infer<typeof browserCompanionHistoryItemSchema>;
export type BrowserCompanionStageResult = z.infer<typeof browserCompanionStageResultSchema>;
export type BrowserCompanionBatchInput = z.infer<typeof browserCompanionBatchInputSchema>;
export type BrowserCompanionBatchItemResult = z.infer<typeof browserCompanionBatchItemResultSchema>;
export type BrowserCompanionBatchResult = z.infer<typeof browserCompanionBatchResultSchema>;
export type BrowserCompanionReopenInput = z.infer<typeof browserCompanionReopenInputSchema>;
export type BrowserCompanionOpenInput = z.infer<typeof browserCompanionOpenInputSchema>;
export type BrowserCompanionOpenResult = z.infer<typeof browserCompanionOpenResultSchema>;
export type BrowserCompanionProfile = z.infer<typeof browserCompanionProfileSchema>;
export type BrowserCompanionBrowser = z.infer<typeof browserCompanionBrowserSchema>;
export type BrowserCompanionDestination = z.infer<typeof browserCompanionDestinationSchema>;
export type BrowserCompanionDestinationsResult = z.infer<typeof browserCompanionDestinationsResultSchema>;
export type BrowserCompanionDestinationSelectInput = z.infer<typeof browserCompanionDestinationSelectInputSchema>;
export type BrowserCompanionBrowserOpenError = NonNullable<BrowserCompanionOpenResult['browserOpenError']>;
export type BrowserCompanionDeleteInput = z.infer<typeof browserCompanionDeleteInputSchema>;
export type BrowserCompanionDeleteResult = z.infer<typeof browserCompanionDeleteResultSchema>;
