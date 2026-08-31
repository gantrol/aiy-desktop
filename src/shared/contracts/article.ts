import { z } from 'zod';

const idSchema = z.string().min(1).max(200);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const articleElementFingerprintSchema = z.string().regex(/^[a-f0-9]{16}$/u);
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

export const articleElementNodeTypeSchema = z.enum([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'image',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
]);

export const articleElementPlacementSchema = z
  .object({
    elementId: idSchema,
    blockIndex: z.number().int().nonnegative().max(100_000),
    nodeType: articleElementNodeTypeSchema,
    textFingerprint: articleElementFingerprintSchema,
    preview: z.string().max(280),
  })
  .strict();

export const articleCommentAnchorSchema = z
  .object({
    kind: z.enum(['TEXT_RANGE', 'BLOCK', 'TABLE', 'TABLE_ROW', 'TABLE_CELL']),
    startElementId: idSchema,
    startOffset: z.number().int().nonnegative().max(1_000_000),
    endElementId: idSchema,
    endOffset: z.number().int().nonnegative().max(1_000_000),
    startBlockIndex: z.number().int().nonnegative().max(100_000),
    endBlockIndex: z.number().int().nonnegative().max(100_000),
    exactQuote: z.string().max(2_000),
    prefix: z.string().max(200),
    suffix: z.string().max(200),
  })
  .strict();

export const articleCommentAnchorUpdateSchema = z
  .object({
    commentId: idSchema,
    anchor: articleCommentAnchorSchema,
  })
  .strict();

export const articleCommentReplySchema = z
  .object({
    id: idSchema,
    commentId: idSchema,
    body: z.string().max(10_000),
    authorId: idSchema.nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const articleCommentModelAuthorSchema = z
  .object({
    providerKey: idSchema,
    modelId: idSchema,
  })
  .strict();

export const articleCommentSchema = z
  .object({
    id: idSchema,
    articleId: idSchema,
    createdRevisionId: idSchema,
    status: z.enum(['OPEN', 'RESOLVED', 'REJECTED']),
    targetResolution: z.enum(['AVAILABLE', 'RELOCATED', 'MISSING']),
    anchor: articleCommentAnchorSchema,
    preview: z.string().max(280),
    body: z.string().max(10_000),
    authorId: idSchema.nullable(),
    modelAuthor: articleCommentModelAuthorSchema.nullable(),
    replies: z.array(articleCommentReplySchema).max(2_000),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    resolvedAt: z.string().min(1).nullable(),
  })
  .strict();

function fingerprintPart(input: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function articleElementTextFingerprint(nodeType: ArticleElementNodeType, text: string) {
  const normalized = `${nodeType}\u0000${text.normalize('NFKC').replace(/\s+/gu, ' ').trim()}`;
  return `${fingerprintPart(normalized, 0x811c9dc5)}${fingerprintPart(normalized, 0x9e3779b9)}`;
}

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

export function canonicalArticleContentJson(input: z.input<typeof articleContentSchema>) {
  const content = articleContentSchema.parse({
    ...input,
    mediaBindings: input.mediaBindings.map((binding) => ({ ...binding })),
  });
  return JSON.stringify(content);
}

const articleAssetSchema = z
  .object({
    id: idSchema,
    kind: z.enum(['GENERATED', 'REFERENCE']),
    originType: z.string().optional(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative().optional(),
    mediaUrl: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();

const articleContentDtoSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().max(200),
    markdown: z.string().max(1_000_000),
    mediaBindings: z.array(articleMediaBindingSchema).max(100),
    coverAssetId: idSchema.nullable(),
    mediaAssets: z.array(articleAssetSchema).max(100),
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
    const hydratedAssetIds = value.mediaAssets.map((asset) => asset.id);
    if (
      assetIds.length !== hydratedAssetIds.length ||
      new Set(hydratedAssetIds).size !== hydratedAssetIds.length ||
      assetIds.some((assetId) => !hydratedAssetIds.includes(assetId))
    ) {
      context.addIssue({ code: 'custom', path: ['mediaAssets'], message: 'Article media hydration is invalid' });
    }
  });

const articleDtoSchema = z
  .object({
    id: idSchema,
    albumId: idSchema.nullable(),
    sourceInspirationStashId: idSchema.nullable(),
    content: articleContentDtoSchema,
    contentHash: sha256Schema,
    revisionId: idSchema,
    revisionNo: z.number().int().positive(),
    elements: z.array(articleElementPlacementSchema).max(20_000),
    comments: z.array(articleCommentSchema).max(20_000),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const articleRevisionSummarySchema = z
  .object({
    articleId: idSchema,
    revisionId: idSchema,
    revisionNo: z.number().int().positive(),
    contentHash: sha256Schema,
    createdAt: z.string().min(1),
  })
  .strict();

export const articleRevisionHistoryInputSchema = z
  .object({
    articleId: idSchema,
    beforeRevisionNo: z.number().int().positive().nullable(),
    limit: z.number().int().min(1).max(100),
  })
  .strict();

export const articleRevisionHistoryResultSchema = z
  .object({
    articleId: idSchema,
    currentRevisionId: idSchema,
    revisions: z.array(articleRevisionSummarySchema).max(100),
    nextBeforeRevisionNo: z.number().int().positive().nullable(),
  })
  .strict();

export const articleRevisionGetInputSchema = z
  .object({
    articleId: idSchema,
    revisionId: idSchema,
  })
  .strict();

export const articleRevisionSchema = z
  .object({
    articleId: idSchema,
    revisionId: idSchema,
    revisionNo: z.number().int().positive(),
    content: articleContentDtoSchema,
    contentHash: sha256Schema,
    elements: z.array(articleElementPlacementSchema).max(20_000),
    createdAt: z.string().min(1),
  })
  .strict();

export const articleSaveInputSchema = z
  .object({
    id: z.null(),
    albumId: idSchema.nullable(),
    sourceInspirationStashId: idSchema.nullable(),
    consumeCreationDraftId: idSchema.nullable(),
    content: articleContentSchema,
  })
  .strict();

export const articleRevisionSaveInputSchema = z
  .object({
    requestId: idSchema,
    articleId: idSchema,
    sessionEpoch: idSchema,
    draftSeq: z.number().int().nonnegative(),
    cause: z.enum(['EDITOR', 'RESTORE', 'SYSTEM']),
    expectedRevisionId: idSchema,
    contentHash: sha256Schema,
    content: articleContentSchema,
    elements: z.array(articleElementPlacementSchema).max(20_000).optional(),
    commentAnchors: z.array(articleCommentAnchorUpdateSchema).max(20_000).optional(),
  })
  .strict();

export function canonicalArticleElementPlacementsJson(input: readonly z.input<typeof articleElementPlacementSchema>[]) {
  const placements = z
    .array(articleElementPlacementSchema)
    .max(20_000)
    .parse(input)
    .map((placement) => ({ ...placement }))
    .sort((left, right) => left.blockIndex - right.blockIndex || left.elementId.localeCompare(right.elementId));
  return JSON.stringify(placements);
}

export function canonicalArticleCommentAnchorUpdatesJson(
  input: readonly z.input<typeof articleCommentAnchorUpdateSchema>[],
) {
  const updates = z
    .array(articleCommentAnchorUpdateSchema)
    .max(20_000)
    .parse(input)
    .map((update) => ({ ...update, anchor: { ...update.anchor } }))
    .sort((left, right) => left.commentId.localeCompare(right.commentId));
  return JSON.stringify(updates);
}

export function articleCommentAnchorUpdates(comments: readonly z.input<typeof articleCommentSchema>[]) {
  return comments.map((comment) => ({ commentId: comment.id, anchor: { ...comment.anchor } }));
}

export function sameArticleElementPlacements(
  left: readonly z.input<typeof articleElementPlacementSchema>[],
  right: readonly z.input<typeof articleElementPlacementSchema>[],
) {
  return canonicalArticleElementPlacementsJson(left) === canonicalArticleElementPlacementsJson(right);
}

export function sameArticleCommentAnchorUpdates(
  left: readonly z.input<typeof articleCommentAnchorUpdateSchema>[],
  right: readonly z.input<typeof articleCommentAnchorUpdateSchema>[],
) {
  return canonicalArticleCommentAnchorUpdatesJson(left) === canonicalArticleCommentAnchorUpdatesJson(right);
}

export function articleCommentAnchorUpdatesAreApplied(
  updates: readonly z.input<typeof articleCommentAnchorUpdateSchema>[],
  current: readonly z.input<typeof articleCommentAnchorUpdateSchema>[],
) {
  const parsedUpdates = z.array(articleCommentAnchorUpdateSchema).max(20_000).parse(updates);
  if (new Set(parsedUpdates.map((update) => update.commentId)).size !== parsedUpdates.length) return false;
  const currentByCommentId = new Map(
    z
      .array(articleCommentAnchorUpdateSchema)
      .max(20_000)
      .parse(current)
      .map((update) => [update.commentId, JSON.stringify(update.anchor)]),
  );
  return parsedUpdates.every((update) => currentByCommentId.get(update.commentId) === JSON.stringify(update.anchor));
}

export const articleCommentMutationInputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('CREATE'),
      articleId: idSchema,
      expectedRevisionId: idSchema,
      anchor: articleCommentAnchorSchema,
      preview: z.string().max(280),
      body: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      operation: z.literal('UPDATE_BODY'),
      articleId: idSchema,
      commentId: idSchema,
      body: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      operation: z.literal('SET_STATUS'),
      articleId: idSchema,
      commentId: idSchema,
      status: z.enum(['OPEN', 'RESOLVED', 'REJECTED']),
    })
    .strict(),
  z
    .object({
      operation: z.literal('ADD_REPLY'),
      articleId: idSchema,
      commentId: idSchema,
      body: z.string().min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      operation: z.literal('DELETE'),
      articleId: idSchema,
      commentId: idSchema,
    })
    .strict(),
]);

export const articleCommentMutationResultSchema = z
  .object({
    articleId: idSchema,
    revisionId: idSchema,
    comments: z.array(articleCommentSchema).max(20_000),
  })
  .strict();

export const articleCheckBlockSchema = z
  .object({
    elementId: idSchema,
    blockIndex: z.number().int().nonnegative().max(100_000),
    nodeType: articleElementNodeTypeSchema,
    text: z.string().min(1).max(1_000_000),
  })
  .strict();

export const articleCheckInputSchema = z
  .object({
    articleId: idSchema,
    expectedRevisionId: idSchema,
    locale: z.enum(['zh', 'en']),
    title: z.string().max(200),
    blocks: z.array(articleCheckBlockSchema).min(1).max(20_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.blocks.map((block) => block.elementId)).size !== value.blocks.length) {
      context.addIssue({ code: 'custom', path: ['blocks'], message: 'Article check block identities must be unique' });
    }
    if (new Set(value.blocks.map((block) => block.blockIndex)).size !== value.blocks.length) {
      context.addIssue({ code: 'custom', path: ['blocks'], message: 'Article check block indexes must be unique' });
    }
    const submittedCharacters = value.title.length + value.blocks.reduce((sum, block) => sum + block.text.length, 0);
    if (submittedCharacters > 1_000_000) {
      context.addIssue({ code: 'custom', path: ['blocks'], message: 'Article check input is too large' });
    }
  });

export const articleCheckFindingSchema = z
  .object({
    anchor: articleCommentAnchorSchema,
    preview: z.string().min(1).max(280),
    body: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const articleCheckResultSchema = z
  .object({
    findings: z.array(articleCheckFindingSchema).max(100),
  })
  .strict();

export const articleCheckRunStatusSchema = z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED']);

export const articleCheckCommentIdsSchema = z
  .array(idSchema)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Article check comment identities must be unique');

export const articleCheckRunSchema = z
  .object({
    id: idSchema,
    articleId: idSchema,
    inputRevisionId: idSchema,
    articleTitle: z.string().max(200),
    locale: z.enum(['zh', 'en']),
    providerKey: idSchema,
    requestedModel: idSchema,
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
    status: articleCheckRunStatusSchema,
    findingCount: z.number().int().nonnegative().max(100).nullable(),
    commentIds: articleCheckCommentIdsSchema,
    errorCode: z.string().min(1).max(100).nullable(),
    errorMessage: z.string().min(1).max(2_000).nullable(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    appliedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.status === 'RUNNING' && run.finishedAt !== null) {
      context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'A running article check cannot be finished' });
    }
    if (run.status !== 'RUNNING' && run.finishedAt === null) {
      context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'A terminal article check must be finished' });
    }
    if (run.status === 'SUCCEEDED' && run.findingCount === null) {
      context.addIssue({
        code: 'custom',
        path: ['findingCount'],
        message: 'A successful article check needs a result',
      });
    }
    if (run.status !== 'SUCCEEDED' && run.appliedAt !== null) {
      context.addIssue({
        code: 'custom',
        path: ['appliedAt'],
        message: 'Only a successful article check can be applied',
      });
    }
  });

export const articleCheckExecutionResultSchema = z
  .object({
    run: articleCheckRunSchema,
    findings: z.array(articleCheckFindingSchema).max(100),
  })
  .strict();

export const articleCheckInvocationResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('success'),
      result: articleCheckExecutionResultSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('error'),
      error: z
        .object({
          code: z.string().trim().min(1).max(100),
          message: z.string().trim().min(1).max(2_000),
        })
        .strict(),
    })
    .strict(),
]);

export const articleCheckRunsListInputSchema = z
  .object({
    cursor: z.string().max(1_000).nullable().default(null),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();

export const articleCheckRunsPageSchema = z
  .object({
    items: z.array(articleCheckRunSchema),
    nextCursor: z.string().max(1_000).nullable(),
  })
  .strict();

export const articleCheckRunApplyInputSchema = z.object({ runId: idSchema }).strict();

export const articleCheckApplyInputSchema = z
  .object({
    articleId: idSchema,
    expectedRevisionId: idSchema,
    findings: z.array(articleCheckFindingSchema).max(100),
  })
  .strict();

export const articleCheckApplyResultSchema = z
  .object({
    articleId: idSchema,
    revisionId: idSchema,
    createdCommentIds: z.array(idSchema).max(100),
    comments: z.array(articleCommentSchema).max(20_000),
  })
  .strict();

export const articleCheckRunApplyResultSchema = articleCheckApplyResultSchema
  .extend({ run: articleCheckRunSchema })
  .strict();

export const articleRevisionSaveResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ACKNOWLEDGED'),
      requestId: idSchema,
      sessionEpoch: idSchema,
      draftSeq: z.number().int().nonnegative(),
      contentHash: sha256Schema,
      createdRevision: z.boolean(),
      article: articleDtoSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('CONFLICT'),
      requestId: idSchema,
      sessionEpoch: idSchema,
      draftSeq: z.number().int().nonnegative(),
      expectedRevisionId: idSchema,
      reason: z.enum(['REVISION_CHANGED', 'HISTORICAL_REPLAY']),
      historicalRevisionId: idSchema.nullable(),
      historicalRevisionNo: z.number().int().positive().nullable(),
      currentArticle: articleDtoSchema,
    })
    .strict(),
]);

export const articleFormAddInputSchema = z
  .object({
    creationItemId: idSchema,
    sourceInspirationStashId: idSchema.nullable(),
    consumeCreationDraftId: idSchema.nullable(),
    content: articleContentSchema,
  })
  .strict();

export const articleFormCreateInputSchema = z
  .object({
    sourceFormId: idSchema,
    sourceInspirationStashId: idSchema.nullable(),
    content: articleContentSchema,
  })
  .strict();

export const articleMoveInputSchema = z.object({ id: idSchema, albumId: idSchema.nullable() }).strict();
export const articleRenameInputSchema = z.object({ id: idSchema, title: z.string().trim().min(1).max(200) }).strict();
export const articleSetArchivedInputSchema = z.object({ id: idSchema, archived: z.boolean() }).strict();
export const articleWechatCopyOptionsSchema = z
  .object({
    linksAsEndReferences: z.boolean(),
    locale: z.enum(['zh', 'en']),
  })
  .strict();
export const articleCopyForWechatInputSchema = articleWechatCopyOptionsSchema.extend({ id: idSchema }).strict();
export const articleCopyForWechatResultSchema = z
  .object({
    embeddedImageCount: z.number().int().nonnegative(),
    remoteImageCount: z.number().int().nonnegative(),
    endReferenceCount: z.number().int().nonnegative(),
  })
  .strict();
export const articleExportMarkdownInputSchema = z.object({ id: idSchema }).strict();
export const articleExportMarkdownResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('SAVED'), filePath: z.string().min(1) }).strict(),
  z.object({ status: z.literal('CANCELLED') }).strict(),
]);

export type ArticleMediaBindingInput = z.infer<typeof articleMediaBindingSchema>;
export type ArticleElementNodeType = z.infer<typeof articleElementNodeTypeSchema>;
export type ArticleElementPlacementInput = z.infer<typeof articleElementPlacementSchema>;
export type ArticleCommentAnchorInput = z.infer<typeof articleCommentAnchorSchema>;
export type ArticleCommentReplyDto = z.infer<typeof articleCommentReplySchema>;
export type ArticleCommentModelAuthor = z.infer<typeof articleCommentModelAuthorSchema>;
export type ArticleCommentDto = z.infer<typeof articleCommentSchema>;
export type ArticleCommentStatus = ArticleCommentDto['status'];
export type ArticleCommentMutationInput = z.infer<typeof articleCommentMutationInputSchema>;
export type ArticleCommentMutationResult = z.infer<typeof articleCommentMutationResultSchema>;
export type ArticleCheckBlockInput = z.infer<typeof articleCheckBlockSchema>;
export type ArticleCheckInput = z.infer<typeof articleCheckInputSchema>;
export type ArticleCheckFinding = z.infer<typeof articleCheckFindingSchema>;
export type ArticleCheckResult = z.infer<typeof articleCheckResultSchema>;
export type ArticleCheckRunStatus = z.infer<typeof articleCheckRunStatusSchema>;
export type ArticleCheckRunDto = z.infer<typeof articleCheckRunSchema>;
export type ArticleCheckExecutionResult = z.infer<typeof articleCheckExecutionResultSchema>;
export type ArticleCheckInvocationResult = z.infer<typeof articleCheckInvocationResultSchema>;
export type ArticleCheckRunsListInput = z.input<typeof articleCheckRunsListInputSchema>;
export type ArticleCheckRunsPage = z.infer<typeof articleCheckRunsPageSchema>;
export type ArticleCheckRunApplyInput = z.infer<typeof articleCheckRunApplyInputSchema>;
export type ArticleCheckApplyInput = z.infer<typeof articleCheckApplyInputSchema>;
export type ArticleCheckApplyResult = z.infer<typeof articleCheckApplyResultSchema>;
export type ArticleCheckRunApplyResult = z.infer<typeof articleCheckRunApplyResultSchema>;
export type ArticleCommentAnchorUpdateInput = NonNullable<
  z.infer<typeof articleRevisionSaveInputSchema>['commentAnchors']
>[number];
export type ArticleContentInput = z.infer<typeof articleContentSchema>;
export type ArticleSaveInput = z.infer<typeof articleSaveInputSchema>;
export type ArticleRevisionSaveInput = z.infer<typeof articleRevisionSaveInputSchema>;
export type ArticleRevisionSaveResult = z.infer<typeof articleRevisionSaveResultSchema>;
export type ArticleRevisionSummaryDto = z.infer<typeof articleRevisionSummarySchema>;
export type ArticleRevisionHistoryInput = z.infer<typeof articleRevisionHistoryInputSchema>;
export type ArticleRevisionHistoryResult = z.infer<typeof articleRevisionHistoryResultSchema>;
export type ArticleRevisionGetInput = z.infer<typeof articleRevisionGetInputSchema>;
export type ArticleRevisionDto = z.infer<typeof articleRevisionSchema>;
export type ArticleFormAddInput = z.infer<typeof articleFormAddInputSchema>;
export type ArticleFormCreateInput = z.infer<typeof articleFormCreateInputSchema>;
export type ArticleMoveInput = z.infer<typeof articleMoveInputSchema>;
export type ArticleRenameInput = z.infer<typeof articleRenameInputSchema>;
export type ArticleSetArchivedInput = z.infer<typeof articleSetArchivedInputSchema>;
export type ArticleWechatCopyOptions = z.infer<typeof articleWechatCopyOptionsSchema>;
export type ArticleCopyForWechatInput = z.infer<typeof articleCopyForWechatInputSchema>;
export type ArticleCopyForWechatResult = z.infer<typeof articleCopyForWechatResultSchema>;
export type ArticleExportMarkdownInput = z.infer<typeof articleExportMarkdownInputSchema>;
