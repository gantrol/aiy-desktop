import { z } from 'zod';
import { contentSourceSchema } from '@/shared/contracts/content-source';
import { htmlFileAttributesSchema } from '@/shared/contracts/html-file';
import { noteFileSchema } from '@/shared/contracts/note-files';

const id = z.string().min(1).max(200);
const epubCfi = z
  .string()
  .max(4096)
  .regex(/^epubcfi\([^\x00-\x1f]+\)$/u);
export const readingSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('CONTENT'),
      id,
      title: z.string().max(1000),
      source: contentSourceSchema,
      revisionId: id,
      text: z.string().max(1_000_000),
    })
    .strict(),
  z.object({ kind: z.literal('FILE'), id, title: z.string().max(1000), file: noteFileSchema }).strict(),
  z.object({ kind: z.literal('HTML'), id, title: z.string().max(1000), file: htmlFileAttributesSchema }).strict(),
]);
export type ReadingSource = z.infer<typeof readingSourceSchema>;
export const readingLocationSchema = z
  .object({
    page: z.number().int().min(1).max(100_000).optional(),
    chapter: z.string().max(1000).optional(),
    epubCfi: epubCfi.optional(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ReadingLocation = z.infer<typeof readingLocationSchema>;
export const readingCitationSchema = z
  .object({ id, sourceId: id, location: readingLocationSchema, quote: z.string().min(1).max(30_000) })
  .strict();
export type ReadingCitation = z.infer<typeof readingCitationSchema>;
export const readingPositionSchema = z
  .object({
    sourceId: id,
    page: z.number().int().min(1).max(100_000).optional(),
    view: z.enum(['PAGE', 'TEXT', 'EPUB']),
    epubCfi: epubCfi.optional(),
    fontSize: z.number().int().min(12).max(32).optional(),
    scrollTop: z.number().finite().min(0).max(100_000_000),
    textOffset: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
export type ReadingPosition = z.infer<typeof readingPositionSchema>;
export const readingEntrySchema = z
  .object({
    id,
    sourceId: id.nullable(),
    kind: z.enum(['EXCERPT', 'NOTE']),
    location: readingLocationSchema,
    quote: z.string().max(30_000),
    text: z.string().max(40_004),
    // Read old notes without discarding their text. New notes use only `text`.
    cue: z.string().max(2000).optional(),
    summary: z.string().max(8000).optional(),
    selected: z.boolean().optional(),
  })
  .strict();
export type ReadingEntry = z.infer<typeof readingEntrySchema>;
export const creationReadingSchema = z
  .object({
    sources: z.array(readingSourceSchema).max(30),
    entries: z.array(readingEntrySchema).max(100),
    activeSourceId: id.nullable(),
    citations: z.array(readingCitationSchema).max(300).optional(),
    positions: z.array(readingPositionSchema).max(30).optional(),
    // Retained only for revision compatibility; no mode or processing UI consumes these fields.
    noteMode: z.enum(['FREE', 'CORNELL']).optional(),
    processing: z
      .object({
        input: z.string().max(100_000),
        body: z.string().max(100_000),
        adopted: z.boolean(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set(value.sources.map((source) => source.id));
    if (
      ids.size !== value.sources.length ||
      new Set(value.entries.map((entry) => entry.id)).size !== value.entries.length
    )
      context.addIssue({ code: 'custom', message: 'READING_DUPLICATE_ID' });
    if (value.activeSourceId && !ids.has(value.activeSourceId))
      context.addIssue({ code: 'custom', message: 'READING_SOURCE_MISSING' });
    if (value.entries.some((entry) => entry.sourceId && !ids.has(entry.sourceId)))
      context.addIssue({ code: 'custom', message: 'READING_ENTRY_SOURCE_MISSING' });
    for (const items of [value.citations ?? [], value.positions ?? []]) {
      if (items.some((item) => !ids.has(item.sourceId)))
        context.addIssue({ code: 'custom', message: 'READING_SOURCE_MISSING' });
    }
    if (
      new Set(value.citations?.map((item) => item.id)).size !== (value.citations?.length ?? 0) ||
      new Set(value.positions?.map((item) => item.sourceId)).size !== (value.positions?.length ?? 0)
    )
      context.addIssue({ code: 'custom', message: 'READING_DUPLICATE_ID' });
    if (JSON.stringify(value).length > 2_000_000) context.addIssue({ code: 'custom', message: 'READING_LIMIT' });
  });
export type CreationReading = z.infer<typeof creationReadingSchema>;
export const emptyCreationReading = (): CreationReading => ({
  sources: [],
  entries: [],
  activeSourceId: null,
});
export const readingFileByteLimit = 32 * 1024 * 1024;
export const readingFileImportSchema = z
  .object({
    spaceId: id,
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\\\\x00-\x1f]+\.(pdf|epub|txt|md)$/i),
    bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= readingFileByteLimit),
  })
  .strict()
  .refine((value) => !/\.(txt|md)$/i.test(value.name) || value.bytes.byteLength <= 1_000_000);
export const readingFileReadSchema = z.object({ spaceId: id, articleId: id, sourceId: id }).strict();
export const readingFileBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= readingFileByteLimit);
export interface CreationReadingApi {
  readingFileImport(input: z.infer<typeof readingFileImportSchema>): Promise<z.infer<typeof noteFileSchema>>;
  readingFileRead(input: z.infer<typeof readingFileReadSchema>): Promise<Uint8Array>;
}
