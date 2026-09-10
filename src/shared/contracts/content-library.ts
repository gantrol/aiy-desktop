import { z } from 'zod';
import { linkCardUrlSchema, type LinkPreview } from '@/shared/contracts/link-card';
import {
  desktopNoteDraftSchema,
  desktopNoteDraftDtoSchema,
  desktopNoteSaveSchema,
  desktopNoteSchema,
} from '@/shared/contracts/desktop-petals';

const id = z.string().min(1).max(200);
export const contentSourceSchema = z
  .object({
    kind: z.enum(['ARTICLE', 'SOCIAL_POST', 'INSPIRATION_STASH', 'VIDEO_DOCUMENT']),
    id,
    branchId: id.optional(),
    noteId: id.optional(),
    revisionId: id.optional(),
  })
  .strict();
export type ContentSource = z.infer<typeof contentSourceSchema>;
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
    source: contentSourceSchema,
    title: z.string(),
    revisionId: id,
    contentHash: z.string(),
    markdown: z.string().max(1_000_000),
    media: z.array(contentMediaSchema).max(400),
    start: z.number().int(),
    end: z.number().int(),
    createdAt: z.string(),
  })
  .strict();
export type ContentReference = z.infer<typeof contentReferenceSchema>;
export const contentLibraryCommandSchema = z.discriminatedUnion('kind', [
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
  z.object({ kind: z.literal('render'), markdown: z.string().max(1_000_000) }).strict(),
  z.object({ kind: z.literal('note-open'), id }).strict(),
  z.object({ kind: z.literal('note-save'), input: desktopNoteSaveSchema }).strict(),
  z.object({ kind: z.literal('note-checkpoint'), input: desktopNoteDraftSchema }).strict(),
  z.object({ kind: z.literal('reveal'), source: contentSourceSchema }).strict(),
]);
export type ContentLibraryCommand = z.infer<typeof contentLibraryCommandSchema>;
export const contentSearchResultSchema = z.object({
  items: z.array(z.object({ source: contentSourceSchema, title: z.string(), preview: z.string() })),
  nextOffset: z.number().nullable(),
});
export const contentNoteOpenSchema = z.object({ note: desktopNoteSchema, draft: desktopNoteDraftDtoSchema.nullable() });
export interface ContentLibraryApi {
  linkPreview(url: string): Promise<LinkPreview>;
  linkOpen(url: string): Promise<void>;
  search(query: string, offset?: number): Promise<z.infer<typeof contentSearchResultSchema>>;
  read(source: ContentSource): Promise<ContentDocument>;
  capture(input: Omit<Extract<ContentLibraryCommand, { kind: 'capture' }>, 'kind'>): Promise<ContentReference>;
  references(ids: string[]): Promise<ContentReference[]>;
  render(markdown: string): Promise<{ markdown: string; media: ContentDocument['media'] }>;
  noteOpen(id: string): Promise<z.infer<typeof contentNoteOpenSchema>>;
  noteSave(input: z.infer<typeof desktopNoteSaveSchema>): Promise<z.infer<typeof desktopNoteSchema>>;
  noteCheckpoint(input: z.infer<typeof desktopNoteDraftSchema>): Promise<void>;
  reveal(source: ContentSource): Promise<void>;
}

export function contentReferenceToken(id: string) {
  return `:::aiy-block ${id}\n:::`;
}
export const contentReferencePattern = /^:::aiy-block ([A-Za-z0-9_-]{1,200})\r?\n:::[ \t]*$/gmu;
