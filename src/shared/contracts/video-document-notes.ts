import { z } from 'zod';

export const videoDocumentNoteSchema = z
  .object({
    id: z.string().min(1).max(200),
    timestampMs: z.number().int().nonnegative(),
    text: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const videoDocumentNotesContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.literal('TIMED_NOTES'),
    notes: z.array(videoDocumentNoteSchema).max(5_000),
  })
  .strict()
  .superRefine((content, context) => {
    const ids = new Set<string>();
    let previousTimestampMs = -1;
    for (const [index, note] of content.notes.entries()) {
      if (ids.has(note.id)) {
        context.addIssue({ code: 'custom', message: 'Note IDs must be unique', path: ['notes', index, 'id'] });
      }
      ids.add(note.id);
      if (note.timestampMs < previousTimestampMs) {
        context.addIssue({
          code: 'custom',
          message: 'Notes must be ordered by time',
          path: ['notes', index, 'timestampMs'],
        });
      }
      previousTimestampMs = note.timestampMs;
    }
  });

export type VideoDocumentNote = z.infer<typeof videoDocumentNoteSchema>;
export type VideoDocumentNotesContent = z.infer<typeof videoDocumentNotesContentSchema>;
