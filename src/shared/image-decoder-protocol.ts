import { z } from 'zod';
import { MAX_UPLOAD_IMAGE_BYTES } from '@/shared/upload-image-policy';
import {
  NATURAL_WATERMARK_CUSTOM_LOGO_MAX_BYTES,
  NATURAL_WATERMARK_MAX_SIZE_RATIO,
  NATURAL_WATERMARK_MIN_SIZE_RATIO,
  naturalWatermarkPositionSchema,
  naturalWatermarkStyleSchema,
  naturalWatermarkTextSchema,
} from '@/shared/contracts/natural-watermark';

export const IMAGE_DECODER_REQUEST_CHANNEL = 'image-decoder:request';
export const IMAGE_DECODER_RESPONSE_CHANNEL = 'image-decoder:response';
export const MAX_IMAGE_DECODER_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_DECODER_OUTPUT_BYTES = 128 * 1024 * 1024;
export const MAX_IMAGE_DECODER_THUMBNAIL_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_DECODER_WATERMARK_OUTPUT_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_DECODER_DIMENSION = 32_768;
export const MAX_IMAGE_DECODER_PIXELS = 4_096 * 4_096;
export const MAX_IMAGE_DECODER_GIF_FRAMES = 1_000;
export const MAX_IMAGE_DECODER_GIF_TOTAL_PIXELS = 256 * 1024 * 1024;

const requestIdSchema = z.string().uuid();
const operationSchema = z.enum(['thumbnail', 'crop', 'normalize', 'watermark', 'compress']);
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
const watermarkLogoBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= NATURAL_WATERMARK_CUSTOM_LOGO_MAX_BYTES);
const watermarkOutputBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_DECODER_WATERMARK_OUTPUT_BYTES);
const watermarkOutputMimeTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const compressedMimeTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);
const compressedBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_UPLOAD_IMAGE_BYTES);
const dimensionSchema = z.number().int().positive().max(MAX_IMAGE_DECODER_DIMENSION);

export const imageDecoderRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      requestId: requestIdSchema,
      operation: z.literal('compress'),
      sourceMimeType: compressedMimeTypeSchema,
      sourceBytes: compressedBytesSchema,
    })
    .strict(),
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
  z
    .object({
      requestId: requestIdSchema,
      operation: z.literal('watermark'),
      sourceMimeType: imageDecoderSourceMimeTypeSchema,
      sourceBytes: sourceBytesSchema,
      logoMimeType: z.enum(['image/png', 'image/svg+xml']),
      logoBytes: watermarkLogoBytesSchema,
      style: naturalWatermarkStyleSchema,
      text: naturalWatermarkTextSchema,
      sizeRatio: z.number().min(NATURAL_WATERMARK_MIN_SIZE_RATIO).max(NATURAL_WATERMARK_MAX_SIZE_RATIO),
      position: naturalWatermarkPositionSchema,
      opacity: z.number().min(0.35).max(0.95),
    })
    .strict(),
]);

const responseBase = {
  requestId: requestIdSchema,
  width: dimensionSchema,
  height: dimensionSchema,
  sourceWidth: dimensionSchema,
  sourceHeight: dimensionSchema,
  ok: z.literal(true),
} as const;

export const imageDecoderResponseSchema = z
  .union([
    z
      .object({
        ...responseBase,
        operation: z.literal('compress'),
        outputBytes: compressedBytesSchema,
        outputMimeType: compressedMimeTypeSchema,
      })
      .strict(),
    z.object({ ...responseBase, operation: z.literal('thumbnail'), pngBytes: thumbnailPngBytesSchema }).strict(),
    z
      .object({
        ...responseBase,
        operation: z.literal('crop'),
        pngBytes: pngBytesSchema,
        ratioWidth: z.number().int().min(1).max(100),
        ratioHeight: z.number().int().min(1).max(100),
        cropX: z.number().int().nonnegative().max(MAX_IMAGE_DECODER_DIMENSION),
        cropY: z.number().int().nonnegative().max(MAX_IMAGE_DECODER_DIMENSION),
        cropWidth: dimensionSchema,
        cropHeight: dimensionSchema,
      })
      .strict(),
    z.object({ ...responseBase, operation: z.literal('normalize'), pngBytes: pngBytesSchema }).strict(),
    z
      .object({
        ...responseBase,
        operation: z.literal('watermark'),
        outputBytes: watermarkOutputBytesSchema,
        outputMimeType: watermarkOutputMimeTypeSchema,
      })
      .strict(),
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
