import { z } from 'zod';
import { embeddedWebPreviewIdSchema } from '@/shared/contracts/embedded-web';

export const htmlFileByteLimit = 4 * 1024 * 1024;
export const htmlFileBatchLimit = 4;
export const htmlFileHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const htmlFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^/\\\x00-\x1f]+\.html?$/i);
export const htmlFileAttributesSchema = z.object({
  objectHash: htmlFileHashSchema,
  fileName: htmlFileNameSchema,
  spaceId: z.string().min(1).max(200),
});
export type HtmlFileAttributes = z.infer<typeof htmlFileAttributesSchema>;
export const htmlFileImportSchema = z
  .object({
    spaceId: htmlFileAttributesSchema.shape.spaceId,
    fileName: htmlFileNameSchema,
    bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= htmlFileByteLimit),
  })
  .strict();
export const htmlFilePreviewSchema = htmlFileAttributesSchema.strict();
export const htmlFilePreviewAccessSchema = z
  .object({
    previewId: embeddedWebPreviewIdSchema,
    url: z.string().max(500),
    expiresAt: z.string().datetime(),
    scriptsAllowed: z.boolean(),
  })
  .strict();
export type HtmlFilePreviewAccess = z.infer<typeof htmlFilePreviewAccessSchema>;

export interface HtmlFileApi {
  htmlFileRead(input: HtmlFileAttributes): Promise<string>;
  htmlFileImport(input: z.infer<typeof htmlFileImportSchema>): Promise<HtmlFileAttributes>;
  htmlFilePreview(input: HtmlFileAttributes): Promise<HtmlFilePreviewAccess>;
  htmlFileRelease(input: { previewId: string }): Promise<void>;
}
