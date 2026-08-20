import { z } from 'zod';

export const IMAGE_DECODER_REQUEST_CHANNEL = 'image-decoder:request';
export const IMAGE_DECODER_RESPONSE_CHANNEL = 'image-decoder:response';
export const MAX_IMAGE_DECODER_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_DECODER_OUTPUT_BYTES = 128 * 1024 * 1024;
export const MAX_IMAGE_DECODER_THUMBNAIL_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_DECODER_DIMENSION = 32_768;
export const MAX_IMAGE_DECODER_PIXELS = 4_096 * 4_096;

const requestIdSchema = z.string().uuid();
const operationSchema = z.enum(['thumbnail', 'crop', 'normalize']);
export const imageDecoderSourceMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);
const sourceBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_DECODER_INPUT_BYTES);
const pngBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_DECODER_OUTPUT_BYTES);
const thumbnailPngBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_DECODER_THUMBNAIL_BYTES);
const dimensionSchema = z.number().int().positive().max(MAX_IMAGE_DECODER_DIMENSION);

export const imageDecoderRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      requestId: requestIdSchema,
      operation: z.literal('thumbnail'),
      sourceMimeType: imageDecoderSourceMimeTypeSchema,
      sourceBytes: sourceBytesSchema,
      size: z.number().int().min(16).max(2_048),
    })
    .strict(),
  z
    .object({
      requestId: requestIdSchema,
      operation: z.literal('crop'),
      sourceMimeType: imageDecoderSourceMimeTypeSchema,
      sourceBytes: sourceBytesSchema,
      ratioWidth: z.number().int().min(1).max(100),
      ratioHeight: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      requestId: requestIdSchema,
      operation: z.literal('normalize'),
      sourceMimeType: imageDecoderSourceMimeTypeSchema,
      sourceBytes: sourceBytesSchema,
    })
    .strict(),
]);

const responseBase = {
  requestId: requestIdSchema,
  pngBytes: pngBytesSchema,
  width: dimensionSchema,
  height: dimensionSchema,
  sourceWidth: dimensionSchema,
  sourceHeight: dimensionSchema,
  ok: z.literal(true),
} as const;

export const imageDecoderResponseSchema = z
  .union([
    z.object({ ...responseBase, operation: z.literal('thumbnail'), pngBytes: thumbnailPngBytesSchema }).strict(),
    z
      .object({
        ...responseBase,
        operation: z.literal('crop'),
        ratioWidth: z.number().int().min(1).max(100),
        ratioHeight: z.number().int().min(1).max(100),
        cropX: z.number().int().nonnegative().max(MAX_IMAGE_DECODER_DIMENSION),
        cropY: z.number().int().nonnegative().max(MAX_IMAGE_DECODER_DIMENSION),
        cropWidth: dimensionSchema,
        cropHeight: dimensionSchema,
      })
      .strict(),
    z.object({ ...responseBase, operation: z.literal('normalize') }).strict(),
    z
      .object({
        requestId: requestIdSchema,
        operation: operationSchema,
        ok: z.literal(false),
        error: z.string().min(1).max(2_000),
      })
      .strict(),
  ])
  .superRefine((response, context) => {
    if (!response.ok) return;
    if (response.width * response.height > MAX_IMAGE_DECODER_PIXELS) {
      context.addIssue({ code: 'custom', message: 'Decoded image exceeds the pixel limit' });
    }
    if (response.sourceWidth * response.sourceHeight > MAX_IMAGE_DECODER_PIXELS) {
      context.addIssue({ code: 'custom', message: 'Image source exceeds the pixel limit' });
    }
  });

export type ImageDecoderRequest = z.infer<typeof imageDecoderRequestSchema>;
export type ImageDecoderSourceMimeType = z.infer<typeof imageDecoderSourceMimeTypeSchema>;
type WithoutRequestId<T> = T extends {
  requestId: string;
  sourceMimeType: ImageDecoderSourceMimeType;
  sourceBytes: Uint8Array;
}
  ? Omit<T, 'requestId' | 'sourceBytes'> & { sourceBytes: Uint8Array<ArrayBufferLike> }
  : never;
export type ImageDecoderRequestInput = WithoutRequestId<ImageDecoderRequest>;
type WithoutSource<T> = T extends {
  sourceMimeType: ImageDecoderSourceMimeType;
  sourceBytes: Uint8Array<ArrayBufferLike>;
}
  ? Omit<T, 'sourceMimeType' | 'sourceBytes'>
  : never;
export type ImageDecoderFileRequestInput = WithoutSource<ImageDecoderRequestInput>;
export type ImageDecoderResponse = z.infer<typeof imageDecoderResponseSchema>;
export type ImageDecoderSuccessResponse = Extract<ImageDecoderResponse, { ok: true }>;
