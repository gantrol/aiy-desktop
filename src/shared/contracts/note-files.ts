import { z } from 'zod';

export const NOTE_FILE_LIMITS = { count: 100, fileBytes: 64 * 1024 * 1024, batchBytes: 256 * 1024 * 1024 } as const;
export const noteFileSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(500),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    extension: z.string().regex(/^\.[a-z0-9]{1,16}$/),
    mimeType: z.string().max(100),
    byteSize: z.number().int().nonnegative().max(NOTE_FILE_LIMITS.fileBytes),
  })
  .strict();
export type NoteFile = z.infer<typeof noteFileSchema>;
const id = z.string().min(1).max(200);
export const noteFileCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('import'),
      id,
      expectedHash: z.string(),
      name: z.string().min(1).max(500),
      bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= NOTE_FILE_LIMITS.fileBytes),
    })
    .strict(),
  z.object({ kind: z.literal('remove'), id, expectedHash: z.string(), fileId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('open'), id, fileId: z.string().uuid() }).strict(),
]);
export type NoteFileCommand = z.infer<typeof noteFileCommandSchema>;
export function noteFileMediaUrl(libraryId: string, stashId: string, fileId: string) {
  return `aiy-media://note-file/${encodeURIComponent(stashId)}?library=${encodeURIComponent(libraryId)}&file=${encodeURIComponent(fileId)}`;
}
