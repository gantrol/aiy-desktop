import { z } from 'zod';
import { desktopNoteSchema, desktopNoteDraftDtoSchema } from '@/shared/contracts/desktop-petals';
import { temporaryFileSummarySchema } from '@/shared/contracts/temporary-files';
import { creationDraftDtoSchema } from '@/shared/contracts/creation-draft';
import { noteFileSchema } from '@/shared/contracts/note-files';
import { imageEditRecordSchema } from '@/shared/contracts/image-edit';

export const temporaryAttachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mimeType: z.string(),
  byteSize: z.number().nonnegative(),
  hash: z.string(),
  extension: z
    .string()
    .regex(/^\.[a-z0-9]{1,16}$/)
    .optional(),
  asset: creationDraftDtoSchema.shape.referenceAssets.element.optional(),
  file: noteFileSchema.optional(),
});
export const temporaryManifestSchema = temporaryFileSummarySchema.extend({
  version: z.literal(1),
  body: z.string().uuid(),
  attachments: z.array(temporaryAttachmentSchema).max(300),
  sourcePath: z.string().optional(),
  promotion: z.object({ libraryId: z.string(), targetId: z.string().optional() }).optional(),
});
export const temporaryBodySchema = z.object({
  note: desktopNoteSchema,
  draft: desktopNoteDraftDtoSchema.nullable(),
  imageEdit: imageEditRecordSchema.optional(),
});
export type TemporaryManifest = z.infer<typeof temporaryManifestSchema>;
export type TemporaryBody = z.infer<typeof temporaryBodySchema>;
export type TemporaryAttachment = z.infer<typeof temporaryAttachmentSchema>;
