import { ipcRenderer } from 'electron';
import {
  IMAGE_DECODER_REQUEST_CHANNEL,
  IMAGE_DECODER_RESPONSE_CHANNEL,
  MAX_IMAGE_DECODER_PIXELS,
  MAX_IMAGE_DECODER_OUTPUT_BYTES,
  MAX_IMAGE_DECODER_THUMBNAIL_BYTES,
  imageDecoderRequestSchema,
  imageDecoderResponseSchema,
  type ImageDecoderRequest,
  type ImageDecoderSuccessResponse,
} from '@/shared/image-decoder-protocol';

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return Math.max(1, a);
}

function assertSafeDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 32_768 ||
    height > 32_768 ||
    width * height > MAX_IMAGE_DECODER_PIXELS
  ) {
    throw new Error('Decoded image dimensions exceed the safety limit');
  }
}

async function canvasPngBytes(canvas: OffscreenCanvas, maximumBytes = MAX_IMAGE_DECODER_OUTPUT_BYTES) {
  const expectedWidth = canvas.width;
  const expectedHeight = canvas.height;
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  canvas.width = 1;
  canvas.height = 1;
  if (blob.type !== 'image/png' || !blob.size || blob.size > maximumBytes) {
    throw new Error('Decoded PNG exceeds the transfer limit');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength !== blob.size || expectedWidth < 1 || expectedHeight < 1) {
    throw new Error('Decoded PNG exceeds the transfer limit');
  }
  return bytes;
}

async function sourceBitmap(request: ImageDecoderRequest) {
  const blob = new Blob([request.sourceBytes], { type: request.sourceMimeType });
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    if (request.sourceMimeType !== 'image/svg+xml') throw error;
    const sourceUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = sourceUrl;
      await image.decode();
      return await createImageBitmap(image);
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }
}

async function decodeRequest(request: ImageDecoderRequest): Promise<ImageDecoderSuccessResponse> {
  let bitmap: ImageBitmap | null = await sourceBitmap(request);
  try {
    assertSafeDimensions(bitmap.width, bitmap.height);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;

    if (request.operation === 'thumbnail') {
      const scale = Math.min(1, request.size / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Chromium canvas is unavailable');
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      bitmap = null;
      return {
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        pngBytes: await canvasPngBytes(canvas, MAX_IMAGE_DECODER_THUMBNAIL_BYTES),
        width,
        height,
        sourceWidth,
        sourceHeight,
      };
    }

    if (request.operation === 'crop') {
      const divisor = greatestCommonDivisor(request.ratioWidth, request.ratioHeight);
      const ratioWidth = request.ratioWidth / divisor;
      const ratioHeight = request.ratioHeight / divisor;
      const scale = Math.min(Math.floor(bitmap.width / ratioWidth), Math.floor(bitmap.height / ratioHeight));
      if (scale < 1) throw new Error('Requested crop ratio is larger than the source image');
      const cropWidth = ratioWidth * scale;
      const cropHeight = ratioHeight * scale;
      const cropX = Math.floor((bitmap.width - cropWidth) / 2);
      const cropY = Math.floor((bitmap.height - cropHeight) / 2);
      const canvas = new OffscreenCanvas(cropWidth, cropHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Chromium canvas is unavailable');
      context.drawImage(bitmap, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      bitmap.close();
      bitmap = null;
      return {
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        pngBytes: await canvasPngBytes(canvas),
        width: cropWidth,
        height: cropHeight,
        sourceWidth,
        sourceHeight,
        ratioWidth,
        ratioHeight,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
      };
    }

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Chromium canvas is unavailable');
    context.drawImage(bitmap, 0, 0);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    bitmap = null;
    return {
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      pngBytes: await canvasPngBytes(canvas),
      width,
      height,
      sourceWidth,
      sourceHeight,
    };
  } finally {
    bitmap?.close();
  }
}

let active = false;

function sendResponse(response: unknown) {
  ipcRenderer.send(IMAGE_DECODER_RESPONSE_CHANNEL, imageDecoderResponseSchema.parse(response));
}

ipcRenderer.on(IMAGE_DECODER_REQUEST_CHANNEL, (_event, rawRequest: unknown) => {
  const decoded = imageDecoderRequestSchema.safeParse(rawRequest);
  if (!decoded.success) return;
  if (active) {
    sendResponse({
      requestId: decoded.data.requestId,
      operation: decoded.data.operation,
      ok: false,
      error: 'Image decoder is already processing a request',
    });
    return;
  }
  active = true;

  void decodeRequest(decoded.data)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        requestId: decoded.data.requestId,
        operation: decoded.data.operation,
        ok: false,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000) || 'Image decode failed',
      }),
    )
    .finally(() => {
      active = false;
    });
});
