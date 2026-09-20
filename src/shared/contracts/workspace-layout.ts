import { z } from 'zod';
import { gifAdoptionTargetSchema, gifWorkspaceStateSchema } from '@/shared/contracts/gif-making';
import { contentLookupInputSchema } from '@/shared/contracts/content-search';

const workspaceIdSchema = z.string().min(1).max(200);
const optionalWorkspaceIdSchema = workspaceIdSchema.nullable();

export const workspaceAppViewSchema = z.enum([
  'creator',
  'documents',
  'dictionary',
  'gallery',
  'search',
  'companion',
  'codexImages',
  'transitionShowcase',
  'packs',
  'aiCenter',
  'contentManagement',
]);

const creatorLocationSchema = z.discriminatedUnion('surface', [
  z
    .object({
      surface: z.literal('animation'),
      documentId: z.string().uuid(),
      seriesId: optionalWorkspaceIdSchema,
      step: gifWorkspaceStateSchema.shape.step,
      title: z.string().max(200),
      frameId: workspaceIdSchema.optional(),
      candidateId: workspaceIdSchema.optional(),
      adoptionTarget: gifAdoptionTargetSchema.optional(),
    })
    .strict(),
  z.object({ surface: z.literal('default') }).strict(),
  z.object({ surface: z.literal('outline'), albumId: optionalWorkspaceIdSchema }).strict(),
  z.object({ surface: z.literal('new-creation'), albumId: optionalWorkspaceIdSchema }).strict(),
  z
    .object({
      surface: z.literal('creation-draft'),
      draftId: workspaceIdSchema,
      derivedVisualId: workspaceIdSchema.optional(),
    })
    .strict(),
  z.object({ surface: z.literal('inspiration-stash'), stashId: workspaceIdSchema }).strict(),
  z.object({ surface: z.literal('image-breakdown'), breakdownId: workspaceIdSchema }).strict(),
  z.object({ surface: z.literal('evaluation-suite'), suiteId: workspaceIdSchema }).strict(),
  z.object({ surface: z.literal('social-post'), postId: workspaceIdSchema }).strict(),
  z.object({ surface: z.literal('article'), articleId: workspaceIdSchema }).strict(),
  z.object({ surface: z.literal('idea-creation'), creationId: workspaceIdSchema }).strict(),
  z
    .object({
      surface: z.literal('existing-creation'),
      seriesId: workspaceIdSchema,
      outputSeriesId: workspaceIdSchema.optional(),
      derivedVisualId: workspaceIdSchema.optional(),
      assetId: optionalWorkspaceIdSchema,
      versionId: workspaceIdSchema.optional(),
      workspace: z.enum(['prompt', 'annotations']).optional(),
    })
    .strict(),
  z.object({ surface: z.literal('album-detail'), albumId: workspaceIdSchema }).strict(),
]);

const dictionaryLocationSchema = z.discriminatedUnion('surface', [
  z.object({ surface: z.literal('overview') }).strict(),
  z.object({ surface: z.literal('classifications'), classificationId: optionalWorkspaceIdSchema }).strict(),
  z.object({ surface: z.enum(['detail', 'edit']), termId: workspaceIdSchema }).strict(),
]);

const galleryCollectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('creation') }).strict(),
  z.object({ kind: z.literal('import') }).strict(),
  z
    .object({
      kind: z.literal('dictionary'),
      scope: z.enum(['ALL', 'FAVORITE']),
      domainId: workspaceIdSchema.optional(),
      typeId: workspaceIdSchema.optional(),
      termId: workspaceIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('album'),
      albumId: workspaceIdSchema,
      creationRelation: z.enum(['ALL', 'INPUT', 'OUTPUT']).optional(),
    })
    .strict(),
]);

const galleryLocationSchema = z
  .object({
    collection: galleryCollectionSchema,
    selectedMaterialKey: z.string().min(1).max(500).nullable(),
    requestedMaterialId: optionalWorkspaceIdSchema,
  })
  .strict();

const videoDocumentCollectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('unfiled') }).strict(),
  z.object({ kind: z.literal('album'), albumId: workspaceIdSchema }).strict(),
]);

export const workspaceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('creator'), location: creatorLocationSchema }).strict(),
  z
    .object({
      kind: z.literal('documents'),
      collection: videoDocumentCollectionSchema,
      documentId: optionalWorkspaceIdSchema,
    })
    .strict(),
  z.object({ kind: z.literal('dictionary'), location: dictionaryLocationSchema }).strict(),
  z.object({ kind: z.literal('gallery'), location: galleryLocationSchema }).strict(),
  z
    .object({ kind: z.literal('search'), location: contentLookupInputSchema.pick({ query: true, type: true }) })
    .strict(),
  z.object({ kind: z.literal('companion') }).strict(),
  z.object({ kind: z.literal('calendar') }).strict(),
  z
    .object({
      kind: z.literal('extensions'),
      view: z.enum(['packs', 'codexImages']),
      tab: z.enum(['plugins', 'contentPacks']),
      pluginId: optionalWorkspaceIdSchema,
      packId: optionalWorkspaceIdSchema,
    })
    .strict(),
  z.object({ kind: z.literal('transition-showcase') }).strict(),
  z
    .object({
      kind: z.literal('ai-center'),
      tab: z.enum(['activity', 'statistics', 'capabilities']),
      recordId: optionalWorkspaceIdSchema,
    })
    .strict(),
  z.object({ kind: z.literal('content-management') }).strict(),
]);

export const articleEditorLocationSchema = z
  .object({
    elementId: workspaceIdSchema,
    blockId: workspaceIdSchema.optional(),
    referenceId: workspaceIdSchema.optional(),
    relativeOffset: z.number().int().nonnegative().max(1_000_000),
    blockIndex: z.number().int().nonnegative().max(100_000).optional(),
    viewportOffset: z.number().int().nonnegative().max(1_000_000).optional(),
  })
  .strict();

export const workspaceNavigationEntrySchema = z
  .object({
    id: workspaceIdSchema,
    target: workspaceTargetSchema,
    articleLocation: articleEditorLocationSchema.nullable(),
  })
  .strict();

export const workspaceTabSchema = z
  .object({
    id: workspaceIdSchema,
    target: workspaceTargetSchema,
    history: z.array(workspaceNavigationEntrySchema).min(1).max(100).optional(),
    historyIndex: z.number().int().nonnegative().max(99).optional(),
  })
  .strict();

export const workspaceGroupSchema = z
  .object({
    id: workspaceIdSchema,
    activeTabId: workspaceIdSchema,
    tabs: z.array(workspaceTabSchema).min(1).max(24),
  })
  .strict();

export const workspaceArrangementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), groupId: workspaceIdSchema }).strict(),
  z
    .object({
      kind: z.literal('split'),
      axis: z.enum(['columns', 'rows']),
      ratio: z.number().int().min(2_500).max(7_500),
      groupIds: z.tuple([workspaceIdSchema, workspaceIdSchema]),
    })
    .strict(),
]);

export const articleEditTrailEntrySchema = articleEditorLocationSchema
  .extend({ recordedAt: z.string().min(1).max(100) })
  .strict();

export const workspaceArticleEditorStateSchema = z
  .object({
    articleId: workspaceIdSchema,
    resumeLocation: articleEditorLocationSchema.nullable(),
    editTrail: z.array(articleEditTrailEntrySchema).max(40),
  })
  .strict();

export const workspaceArticleEditOwnerSchema = z
  .object({
    articleId: workspaceIdSchema,
    tabId: workspaceIdSchema,
  })
  .strict();

export const workspaceVisualResumeSchema = z
  .object({
    visualId: workspaceIdSchema,
    seriesId: workspaceIdSchema,
    versionId: workspaceIdSchema,
    assetId: optionalWorkspaceIdSchema,
    outputSeriesId: workspaceIdSchema.optional(),
  })
  .strict();
export type WorkspaceVisualResumeDto = z.infer<typeof workspaceVisualResumeSchema>;

export const workspaceLayoutStateSchema = z
  .object({
    activeGroupId: workspaceIdSchema,
    arrangement: workspaceArrangementSchema,
    groups: z.array(workspaceGroupSchema).min(1).max(2),
    articleEditors: z.array(workspaceArticleEditorStateSchema).max(24).default([]),
    articleEditOwners: z.array(workspaceArticleEditOwnerSchema).max(24).default([]),
    visualWorkspaces: z.array(workspaceVisualResumeSchema).max(100).default([]),
  })
  .strict()
  .superRefine((state, context) => {
    const groupIds = new Set(state.groups.map((group) => group.id));
    if (new Set(state.visualWorkspaces.map((entry) => entry.visualId)).size !== state.visualWorkspaces.length) {
      context.addIssue({ code: 'custom', message: 'Visual workspace identities must be unique' });
    }
    if (groupIds.size !== state.groups.length) {
      context.addIssue({ code: 'custom', message: 'Workspace group IDs must be unique' });
    }
    if (!groupIds.has(state.activeGroupId)) {
      context.addIssue({ code: 'custom', message: 'The active workspace group is unavailable' });
    }
    const arrangedIds =
      state.arrangement.kind === 'single' ? [state.arrangement.groupId] : [...state.arrangement.groupIds];
    if (arrangedIds.length !== state.groups.length || arrangedIds.some((groupId) => !groupIds.has(groupId))) {
      context.addIssue({ code: 'custom', message: 'The workspace arrangement does not match its groups' });
    }
    if (new Set(arrangedIds).size !== arrangedIds.length) {
      context.addIssue({ code: 'custom', message: 'A workspace group cannot occupy two split positions' });
    }
    const tabIds = new Set<string>();
    for (const group of state.groups) {
      const ownTabIds = new Set(group.tabs.map((tab) => tab.id));
      if (ownTabIds.size !== group.tabs.length || !ownTabIds.has(group.activeTabId)) {
        context.addIssue({ code: 'custom', message: 'Workspace tab identities are invalid' });
      }
      for (const tabId of ownTabIds) {
        if (tabIds.has(tabId)) context.addIssue({ code: 'custom', message: 'Workspace tab IDs must be unique' });
        tabIds.add(tabId);
      }
    }
    const articleIds = state.articleEditors.map((editor) => editor.articleId);
    if (new Set(articleIds).size !== articleIds.length) {
      context.addIssue({ code: 'custom', message: 'Article editor state IDs must be unique' });
    }
    const ownerArticleIds = state.articleEditOwners.map((owner) => owner.articleId);
    if (new Set(ownerArticleIds).size !== ownerArticleIds.length) {
      context.addIssue({ code: 'custom', message: 'Article edit ownership must be unique' });
    }
    if (state.articleEditOwners.some((owner) => !tabIds.has(owner.tabId))) {
      context.addIssue({ code: 'custom', message: 'Article edit ownership refers to an unavailable tab' });
    }
  });

export const workspaceLayoutSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    spaceId: workspaceIdSchema,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    state: workspaceLayoutStateSchema,
  })
  .strict();

export const workspaceLayoutSaveInputSchema = z
  .object({
    spaceId: workspaceIdSchema,
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    state: workspaceLayoutStateSchema,
  })
  .strict();

export const workspaceLayoutSaveResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), snapshot: workspaceLayoutSnapshotSchema }).strict(),
  z.object({ status: z.literal('conflict'), snapshot: workspaceLayoutSnapshotSchema.nullable() }).strict(),
]);

export type WorkspaceAppView = z.infer<typeof workspaceAppViewSchema>;
export type WorkspaceTarget = z.infer<typeof workspaceTargetSchema>;
export type WorkspaceNavigationEntryDto = z.infer<typeof workspaceNavigationEntrySchema>;
export type WorkspaceTabDto = z.infer<typeof workspaceTabSchema>;
export type WorkspaceGroupDto = z.infer<typeof workspaceGroupSchema>;
export type WorkspaceArrangementDto = z.infer<typeof workspaceArrangementSchema>;
export type ArticleEditorLocationDto = z.infer<typeof articleEditorLocationSchema>;
export type ArticleEditTrailEntryDto = z.infer<typeof articleEditTrailEntrySchema>;
export type WorkspaceArticleEditorStateDto = z.infer<typeof workspaceArticleEditorStateSchema>;
export type WorkspaceArticleEditOwnerDto = z.infer<typeof workspaceArticleEditOwnerSchema>;
export type WorkspaceLayoutStateDto = z.infer<typeof workspaceLayoutStateSchema>;
export type WorkspaceLayoutSnapshotDto = z.infer<typeof workspaceLayoutSnapshotSchema>;
export type WorkspaceLayoutSaveInput = z.infer<typeof workspaceLayoutSaveInputSchema>;
export type WorkspaceLayoutSaveResult = z.infer<typeof workspaceLayoutSaveResultSchema>;
