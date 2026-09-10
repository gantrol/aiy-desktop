import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { blockDocumentSchema } from '@/shared/contracts/block-document';
import { z } from 'zod';

interface RichNoteSchemaDependencies<
  TranscriptBasis extends z.ZodType,
  GenerationReceipt extends z.ZodType,
  MediaBinding extends z.ZodType<{ path: string; assetId: string }>,
  TimelineSegment extends z.ZodType<{ startTimestampMs: number }>,
> {
  transcriptBasis: TranscriptBasis;
  generationReceipt: GenerationReceipt;
  mediaBinding: MediaBinding;
  timelineSegment: TimelineSegment;
}

export function createVideoDocumentRichNoteSchemas<
  TranscriptBasis extends z.ZodType,
  GenerationReceipt extends z.ZodType,
  MediaBinding extends z.ZodType<{ path: string; assetId: string }>,
  TimelineSegment extends z.ZodType<{ startTimestampMs: number }>,
>({
  transcriptBasis,
  generationReceipt,
  mediaBinding,
  timelineSegment,
}: RichNoteSchemaDependencies<TranscriptBasis, GenerationReceipt, MediaBinding, TimelineSegment>) {
  const richNote = z
    .object({
      id: z.string().min(1).max(200),
      title: z.string().trim().max(300),
      markdown: z.string().min(1).max(500_000),
      document: blockDocumentSchema.optional(),
      transcriptBasis,
      sourceUrl: z
        .string()
        .url()
        .max(2_000)
        .refine((value) => new URL(value).protocol === 'https:', 'Document source URLs must use HTTPS')
        .nullable(),
      generation: generationReceipt.nullable().optional(),
      mediaBindings: z.array(mediaBinding).max(200),
      timelineSegments: z.array(timelineSegment).max(500).optional(),
      createdAt: z.string().min(1).max(100),
      updatedAt: z.string().min(1).max(100),
    })
    .strict()
    .superRefine((note, context) => {
      const paths = new Set<string>();
      for (const [index, binding] of note.mediaBindings.entries()) {
        if (paths.has(binding.path)) {
          context.addIssue({
            code: 'custom',
            message: 'Document media paths must be unique within a note',
            path: ['mediaBindings', index, 'path'],
          });
        }
        paths.add(binding.path);
      }
      let previousStartTimestampMs = -1;
      for (const [index, segment] of (note.timelineSegments ?? []).entries()) {
        if (segment.startTimestampMs < previousStartTimestampMs) {
          context.addIssue({
            code: 'custom',
            message: 'Timeline segments must be ordered by start time',
            path: ['timelineSegments', index, 'startTimestampMs'],
          });
        }
        previousStartTimestampMs = segment.startTimestampMs;
      }
    })
    .transform((note) =>
      note.document ? { ...note, markdown: blockDocumentMarkdown(note.document, note.mediaBindings) } : note,
    );

  const collection = z
    .object({
      schemaVersion: z.union([z.literal(2), z.literal(3)]),
      format: z.literal('NOTE_COLLECTION'),
      defaultNoteId: z.string().min(1).max(200),
      notes: z.array(richNote).min(1).max(50),
    })
    .strict()
    .superRefine((content, context) => {
      const ids = new Set<string>();
      for (const [index, note] of content.notes.entries()) {
        if (ids.has(note.id)) {
          context.addIssue({ code: 'custom', message: 'Note IDs must be unique', path: ['notes', index, 'id'] });
        }
        ids.add(note.id);
      }
      if (!ids.has(content.defaultNoteId)) {
        context.addIssue({
          code: 'custom',
          message: 'The default note must belong to the collection',
          path: ['defaultNoteId'],
        });
      }
    });

  return { richNote, collection };
}
