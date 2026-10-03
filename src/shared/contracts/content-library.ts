import {
  commentCompilationInputSchema,
  type CommentCompilationInput,
  type CommentCompilationResult,
} from '@/shared/contracts/comment-compilation';
import {
  articleOutlineStartInputSchema,
  type ArticleOutlineStartInput,
  type ArticleOutlineStartResult,
} from '@/shared/contracts/article-outline-start';
import { contentLookupInputSchema, type ContentLookupApi } from '@/shared/contracts/content-search';
import { z } from 'zod';
import {
  outlinePageCreateInputSchema,
  type OutlinePageCreateInput,
  type OutlinePageCreateResult,
} from '@/shared/contracts/outline-page';
import { blockDocumentSchema } from '@/shared/contracts/block-document';
import {
  referencePresentationSchema,
  referenceEditingSchema,
  type ReferenceEditing,
  type ReferencePresentation,
} from '@/shared/content-reference-token';
import {
  articleStructureInputSchema,
  type ArticleStructureInput,
  type ArticleStructurePage,
} from '@/shared/contracts/article-structure';
import {
  outlineTransferInputSchema,
  type OutlineTransferInput,
  type OutlineTransferResult,
} from '@/shared/contracts/outline-transfer';
import {
  contentLinkInputSchema,
  outlineLinkedCreateInputSchema,
  type ContentLinkInput,
  type ContentLinkResult,
  type ContentLinkUses,
  type OutlineLinkedCreateInput,
} from '@/shared/contracts/content-links';
import {
  agentContentTargetSchema,
  type AgentContentTarget,
  type AgentContentLinkResult,
} from '@/shared/contracts/agent-content';
import { articleOpenResultSchema } from '@/shared/contracts/article';
import { linkCardUrlSchema, type LinkPreview } from '@/shared/contracts/link-card';
import {
  desktopNoteDraftSchema,
  desktopNoteDraftDtoSchema,
  desktopNoteSaveSchema,
  desktopNoteSchema,
  noteCommentMutationInputSchema,
  noteCommentMutationResultSchema,
} from '@/shared/contracts/desktop-petals';
import {
  contentSourceSchema,
  referenceSourceSchema,
  referenceTargetSchema,
  referenceSelectorSchema,
} from '@/shared/contracts/content-source';
export { contentSourceSchema, type ContentSource } from '@/shared/contracts/content-source';
import type { ContentSource, ReferenceTarget } from '@/shared/contracts/content-source';

const id = z.string().min(1).max(200);
export const contentMediaSchema = z
  .object({
    assetId: id,
    path: z.string().max(500),
    mediaUrl: z.string().max(1000),
    mimeType: z.string(),
    width: z.number(),
    height: z.number(),
    byteSize: z.number(),
  })
  .strict();
export const contentRenderInvocationSchema = z.union([
  z.object({ markdown: z.string(), media: z.array(contentMediaSchema) }),
  z.object({ errorCode: z.literal('CONTENT_LIBRARY_SPACE_CHANGED') }).strict(),
]);
export const contentDocumentSchema = z
  .object({
    source: contentSourceSchema,
    title: z.string(),
    displayTitle: z.string(),
    revisionId: id,
    contentHash: z.string(),
    markdown: z.string().max(1_000_000),
    media: z.array(contentMediaSchema).max(400),
    blocks: z.array(z.object({ start: z.number().int(), end: z.number().int(), preview: z.string() })).max(20000),
  })
  .strict();
export type ContentDocument = z.infer<typeof contentDocumentSchema>;
export const contentReferenceSchema = z
  .object({
    id,
    spaceId: id.optional(),
    source: referenceSourceSchema,
    document: blockDocumentSchema.optional(),
    title: z.string(),
    revisionId: id,
    contentHash: z.string(),
    markdown: z.string().max(1_000_000),
    media: z.array(contentMediaSchema).max(400),
    start: z.number().int(),
    end: z.number().int(),
    createdAt: z.string(),
    selector: referenceSelectorSchema.optional(),
  })
  .strict();
export type ContentReference = z.infer<typeof contentReferenceSchema>;
export const resolvedContentReferenceSchema = z.object({
  reference: contentReferenceSchema,
  captured: contentReferenceSchema.optional(),
  mode: z.enum(['FIXED', 'FOLLOW']),
  state: z.enum(['CURRENT', 'UNAVAILABLE']),
  reason: z.string().optional(),
});
export type ResolvedContentReference = z.infer<typeof resolvedContentReferenceSchema>;
export const contentResolutionSchema = z.object({
  resolutionId: id,
  markdown: z.string().max(1_000_000),
  media: z.array(contentMediaSchema).max(400),
  contentHash: z.string(),
});
export type ContentResolution = z.infer<typeof contentResolutionSchema>;
export const referenceHistoryResultSchema = z
  .object({
    spaceId: id,
    articleId: id,
    revisionId: id,
    state: z.enum(['COMPLETE', 'UNAVAILABLE', 'LEGACY']),
    resolutionId: id.optional(),
    markdown: z.string().max(1_000_000),
    media: z.array(contentMediaSchema).max(400),
    bindings: z.record(id, id),
  })
  .strict();
export type ReferenceHistoryResult = z.infer<typeof referenceHistoryResultSchema>;
export const referencePreviewSchema = z
  .object({
    spaceId: z.string().min(1).max(200).optional(),
    target: referenceTargetSchema,
    document: blockDocumentSchema.optional(),
    resolutionId: id.optional(),
    title: z.string(),
    version: id,
    revisionId: id,
    markdown: z.string().max(1_000_000),
    media: z.array(contentMediaSchema).max(400),
    blocks: z.array(z.object({ id, title: z.string(), kind: z.string(), depth: z.number().int() })).max(20000),
    selector: referenceSelectorSchema.optional(),
  })
  .strict();
export type ReferencePreview = z.infer<typeof referencePreviewSchema>;
export const referenceOpenResultSchema = z
  .object({
    spaceId: id,
    article: articleOpenResultSchema.shape.article,
    blockId: id.nullable(),
  })
  .strict();
export type ReferenceOpenResult = z.infer<typeof referenceOpenResultSchema>;
export const referenceSearchResultSchema = z.object({
  items: z.array(z.object({ target: referenceTargetSchema, title: z.string(), preview: z.string() })),
  nextOffset: z.number().nullable(),
});
export const referenceUsesSchema = z.object({
  scope: z.literal('CURRENT_ARTICLES'),
  items: z
    .array(
      z.object({
        source: contentSourceSchema,
        title: z.string(),
        blockId: id.nullable(),
        referenceId: id,
        relation: z.enum(['DIRECT', 'CONTAINED']),
        mode: z.enum(['FIXED', 'FOLLOW']),
        via: referenceTargetSchema,
        path: z.array(z.object({ blockId: id, title: z.string() })).max(200),
      }),
    )
    .max(1000),
  partial: z.boolean(),
  nextOffset: z.number().nullable(),
});
export type ReferenceUse = z.infer<typeof referenceUsesSchema>['items'][number];
export const contentLibraryCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('comment-compilation-create'), input: commentCompilationInputSchema }).strict(),
  z.object({ kind: z.literal('article-outline-start'), input: articleOutlineStartInputSchema }).strict(),
  z.object({ kind: z.literal('outline-page-create'), input: outlinePageCreateInputSchema }).strict(),
  z.object({ kind: z.literal('reference-history'), articleId: id, revisionId: id, spaceId: id }).strict(),
  z.object({ kind: z.literal('article-structure'), input: articleStructureInputSchema }).strict(),
  z
    .object({
      kind: z.literal('content-link-resolve'),
      input: contentLinkInputSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('outline-linked-create'),
      input: outlineLinkedCreateInputSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('content-link-uses'),
      input: contentLinkInputSchema,
      offset: z.number().int().min(0).max(1_000_000).default(0),
    })
    .strict(),
  z.object({ kind: z.literal('agent-link'), target: agentContentTargetSchema }).strict(),
  z.object({ kind: z.literal('lookup'), input: contentLookupInputSchema }).strict(),
  z
    .object({
      kind: z.literal('reference-search'),
      category: z.enum(['CONTENT', 'CREATION_ITEM', 'ALBUM']),
      query: z.string().max(200),
      offset: z.number().int().min(0).max(1_000_000).default(0),
    })
    .strict(),
  z.object({ kind: z.literal('reference-inspect'), target: referenceTargetSchema }).strict(),
  z.object({ kind: z.literal('reference-open'), target: referenceTargetSchema, referenceId: id.optional() }).strict(),
  z
    .object({
      kind: z.literal('reference-capture'),
      target: referenceTargetSchema,
      expectedVersion: id,
      resolutionId: id.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('reference-follow'), target: referenceTargetSchema, expectedVersion: id }).strict(),
  z.object({ kind: z.literal('reference-resolve'), ids: z.array(id).max(100) }).strict(),
  z
    .object({ kind: z.literal('reference-freeze'), id, expectedRevisionId: id, expectedContentHash: z.string() })
    .strict(),
  z
    .object({
      kind: z.literal('reference-copy'),
      id,
      format: z.enum(['REFERENCE', 'TEXT']),
      presentation: referencePresentationSchema.optional(),
      editing: referenceEditingSchema.optional(),
      parentLevel: z.number().int().min(0).max(6).optional(),
      expectedRevisionId: id.optional(),
      expectedContentHash: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('reference-uses'),
      target: referenceTargetSchema,
      offset: z.number().int().min(0).max(1_000_000).default(0),
    })
    .strict(),
  z.object({ kind: z.literal('link-preview'), url: linkCardUrlSchema, refresh: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('link-open'), url: linkCardUrlSchema }).strict(),
  z
    .object({
      kind: z.literal('search'),
      query: z.string().max(200),
      offset: z.number().int().min(0).max(1_000_000).default(0),
    })
    .strict(),
  z.object({ kind: z.literal('read'), source: contentSourceSchema }).strict(),
  z.object({ kind: z.literal('read-current'), source: contentSourceSchema }).strict(),
  z
    .object({
      kind: z.literal('capture'),
      source: contentSourceSchema,
      revisionId: id,
      contentHash: z.string(),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('references'), ids: z.array(id).max(100) }).strict(),
  z.object({ kind: z.literal('render'), markdown: z.string().max(1_000_000), expectedSpaceId: id.optional() }).strict(),
  z.object({ kind: z.literal('freeze'), markdown: z.string().max(1_000_000), expectedSpaceId: id.optional() }).strict(),
  z
    .object({
      kind: z.literal('render-frozen'),
      markdown: z.string().max(1_000_000),
      resolutionId: id,
      expectedSpaceId: id.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('note-open'), id }).strict(),
  z.object({ kind: z.literal('note-save'), input: desktopNoteSaveSchema }).strict(),
  z.object({ kind: z.literal('outline-transfer'), input: outlineTransferInputSchema }).strict(),
  z.object({ kind: z.literal('note-checkpoint'), input: desktopNoteDraftSchema }).strict(),
  z.object({ kind: z.literal('note-comment-mutate'), input: noteCommentMutationInputSchema }).strict(),
  z.object({ kind: z.literal('reveal'), source: contentSourceSchema }).strict(),
]);
export type ContentLibraryCommand = z.infer<typeof contentLibraryCommandSchema>;
export const contentSearchResultSchema = z.object({
  items: z.array(z.object({ source: contentSourceSchema, title: z.string(), preview: z.string() })),
  nextOffset: z.number().nullable(),
});
export const contentNoteOpenSchema = z.object({ note: desktopNoteSchema, draft: desktopNoteDraftDtoSchema.nullable() });
export interface ContentLibraryApi extends ContentLookupApi {
  commentCompilationCreate(input: CommentCompilationInput): Promise<CommentCompilationResult>;
  articleOutlineStart(input: ArticleOutlineStartInput): Promise<ArticleOutlineStartResult>;
  referenceHistory(articleId: string, revisionId: string, spaceId: string): Promise<ReferenceHistoryResult>;
  articleStructure(input: ArticleStructureInput): Promise<ArticleStructurePage>;
  outlineTransfer(input: OutlineTransferInput): Promise<OutlineTransferResult>;
  outlinePageCreate(input: OutlinePageCreateInput): Promise<OutlinePageCreateResult>;
  linkResolve(input: ContentLinkInput): Promise<ContentLinkResult>;
  outlineLinkedCreate(input: OutlineLinkedCreateInput): Promise<ContentLinkResult>;
  linkUses(input: ContentLinkInput, offset?: number): Promise<ContentLinkUses>;
  agentLink(target: AgentContentTarget): Promise<AgentContentLinkResult>;
  referenceSearch(
    category: 'CONTENT' | 'CREATION_ITEM' | 'ALBUM',
    query: string,
    offset?: number,
  ): Promise<z.infer<typeof referenceSearchResultSchema>>;
  referenceInspect(target: ReferenceTarget): Promise<ReferencePreview>;
  referenceOpen(target: ReferenceTarget, referenceId?: string): Promise<ReferenceOpenResult>;
  referenceCapture(target: ReferenceTarget, expectedVersion: string, resolutionId?: string): Promise<ContentReference>;
  referenceFollow(target: ReferenceTarget, expectedVersion: string): Promise<ContentReference>;
  referenceResolve(ids: string[]): Promise<ResolvedContentReference[]>;
  referenceFreeze(id: string, expectedRevisionId: string, expectedContentHash: string): Promise<ContentReference>;
  referenceCopy(
    id: string,
    format: 'REFERENCE' | 'TEXT',
    options?: {
      presentation?: ReferencePresentation;
      editing?: ReferenceEditing;
      parentLevel?: number;
      expectedRevisionId?: string;
      expectedContentHash?: string;
    },
  ): Promise<void>;
  referenceUses(target: ReferenceTarget, offset?: number): Promise<z.infer<typeof referenceUsesSchema>>;
  linkPreview(url: string, refresh?: boolean): Promise<LinkPreview>;
  linkOpen(url: string): Promise<void>;
  search(query: string, offset?: number): Promise<z.infer<typeof contentSearchResultSchema>>;
  read(source: ContentSource): Promise<ContentDocument>;
  readCurrent(source: ContentSource): Promise<ContentDocument>;
  capture(input: Omit<Extract<ContentLibraryCommand, { kind: 'capture' }>, 'kind'>): Promise<ContentReference>;
  references(ids: string[]): Promise<ContentReference[]>;
  render(markdown: string, expectedSpaceId?: string): Promise<{ markdown: string; media: ContentDocument['media'] }>;
  freeze(markdown: string, expectedSpaceId?: string): Promise<ContentResolution>;
  renderFrozen(
    markdown: string,
    resolutionId: string,
    expectedSpaceId?: string,
  ): Promise<{ markdown: string; media: ContentDocument['media'] }>;
  noteOpen(id: string): Promise<z.infer<typeof contentNoteOpenSchema>>;
  noteSave(input: z.infer<typeof desktopNoteSaveSchema>): Promise<z.infer<typeof desktopNoteSchema>>;
  noteCheckpoint(input: z.infer<typeof desktopNoteDraftSchema>): Promise<void>;
  noteCommentMutate(
    input: z.infer<typeof noteCommentMutationInputSchema>,
  ): Promise<z.infer<typeof noteCommentMutationResultSchema>>;
  reveal(source: ContentSource): Promise<void>;
}
export { contentReferenceToken } from '@/shared/content-reference-token';
export const contentReferencePattern = /^:::aiy-block ([A-Za-z0-9_-]{1,200})\r?\n:::[ \t]*$/gmu;
