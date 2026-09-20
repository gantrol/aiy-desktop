import { contentLookupInputSchema, type ContentLookupApi } from '@/shared/contracts/content-search';
import { z } from 'zod';
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
    source: referenceSourceSchema,
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
export const referencePreviewSchema = z
  .object({
    target: referenceTargetSchema,
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
    .array(z.object({ source: contentSourceSchema, title: z.string(), blockId: id.nullable(), referenceId: id }))
    .max(1000),
  nextOffset: z.number().nullable(),
});
export const contentLibraryCommandSchema = z.discriminatedUnion('kind', [
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
  z.object({ kind: z.literal('reference-capture'), target: referenceTargetSchema, expectedVersion: id }).strict(),
  z.object({ kind: z.literal('reference-copy'), id, format: z.enum(['REFERENCE', 'TEXT']) }).strict(),
  z
    .object({
      kind: z.literal('reference-uses'),
      target: referenceTargetSchema,
      offset: z.number().int().min(0).max(1_000_000).default(0),
    })
    .strict(),
  z.object({ kind: z.literal('link-preview'), url: linkCardUrlSchema }).strict(),
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
  z.object({ kind: z.literal('note-open'), id }).strict(),
  z.object({ kind: z.literal('note-save'), input: desktopNoteSaveSchema }).strict(),
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
  agentLink(target: AgentContentTarget): Promise<AgentContentLinkResult>;
  referenceSearch(
    category: 'CONTENT' | 'CREATION_ITEM' | 'ALBUM',
    query: string,
    offset?: number,
  ): Promise<z.infer<typeof referenceSearchResultSchema>>;
  referenceInspect(target: ReferenceTarget): Promise<ReferencePreview>;
  referenceOpen(target: ReferenceTarget, referenceId?: string): Promise<ReferenceOpenResult>;
  referenceCapture(target: ReferenceTarget, expectedVersion: string): Promise<ContentReference>;
  referenceCopy(id: string, format: 'REFERENCE' | 'TEXT'): Promise<void>;
  referenceUses(target: ReferenceTarget, offset?: number): Promise<z.infer<typeof referenceUsesSchema>>;
  linkPreview(url: string): Promise<LinkPreview>;
  linkOpen(url: string): Promise<void>;
  search(query: string, offset?: number): Promise<z.infer<typeof contentSearchResultSchema>>;
  read(source: ContentSource): Promise<ContentDocument>;
  readCurrent(source: ContentSource): Promise<ContentDocument>;
  capture(input: Omit<Extract<ContentLibraryCommand, { kind: 'capture' }>, 'kind'>): Promise<ContentReference>;
  references(ids: string[]): Promise<ContentReference[]>;
  render(markdown: string, expectedSpaceId?: string): Promise<{ markdown: string; media: ContentDocument['media'] }>;
  noteOpen(id: string): Promise<z.infer<typeof contentNoteOpenSchema>>;
  noteSave(input: z.infer<typeof desktopNoteSaveSchema>): Promise<z.infer<typeof desktopNoteSchema>>;
  noteCheckpoint(input: z.infer<typeof desktopNoteDraftSchema>): Promise<void>;
  noteCommentMutate(
    input: z.infer<typeof noteCommentMutationInputSchema>,
  ): Promise<z.infer<typeof noteCommentMutationResultSchema>>;
  reveal(source: ContentSource): Promise<void>;
}
export function contentReferenceToken(id: string) {
  return `:::aiy-block ${id}\n:::`;
}
export const contentReferencePattern = /^:::aiy-block ([A-Za-z0-9_-]{1,200})\r?\n:::[ \t]*$/gmu;
