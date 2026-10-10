import { z } from 'zod';

export const EMBEDDED_WEB_EXTENSION_ID = 'com.aiy.embedded-web';
export const embeddedWebPreviewIdSchema = z.string().regex(/^[a-f0-9]{48}$/);
export const embeddedWebBoundsSchema = z
  .object({
    x: z.number().finite().min(0).max(32_768),
    y: z.number().finite().min(0).max(32_768),
    width: z.number().finite().min(0).max(32_768),
    height: z.number().finite().min(0).max(32_768),
  })
  .strict();
export const embeddedWebShowSchema = z
  .object({
    previewId: embeddedWebPreviewIdSchema,
    bounds: embeddedWebBoundsSchema,
    replaceExisting: z.boolean().optional(),
  })
  .strict();
export const embeddedWebHideSchema = z.object({ previewId: embeddedWebPreviewIdSchema }).strict();
export const embeddedWebClosedSchema = z
  .object({
    previewId: embeddedWebPreviewIdSchema,
    reason: z.enum(['STOPPED', 'FAILED']),
  })
  .strict();
export type EmbeddedWebBounds = z.infer<typeof embeddedWebBoundsSchema>;
export type EmbeddedWebShowInput = z.infer<typeof embeddedWebShowSchema>;
export type EmbeddedWebClosed = z.infer<typeof embeddedWebClosedSchema>;

export interface EmbeddedWebApi {
  embeddedWebShow(input: EmbeddedWebShowInput): Promise<void>;
  embeddedWebHide(input: z.infer<typeof embeddedWebHideSchema>): Promise<void>;
  onEmbeddedWebClosed(callback: (event: EmbeddedWebClosed) => void): () => void;
}
