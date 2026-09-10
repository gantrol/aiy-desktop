import { ipcRenderer } from 'electron';
import { watermarkGif } from '@/preload/gif-watermark';
import {
  IMAGE_DECODER_REQUEST_CHANNEL,
  IMAGE_DECODER_RESPONSE_CHANNEL,
  MAX_IMAGE_DECODER_PIXELS,
  MAX_IMAGE_DECODER_OUTPUT_BYTES,
  MAX_IMAGE_DECODER_THUMBNAIL_BYTES,
  MAX_IMAGE_DECODER_WATERMARK_OUTPUT_BYTES,
  imageDecoderRequestSchema,
  imageDecoderResponseSchema,
  type ImageDecoderRequest,
  type ImageDecoderSuccessResponse,
} from '@/shared/image-decoder-protocol';

type WatermarkRequest = Extract<ImageDecoderRequest, { operation: 'watermark' }>;

const AICANDO_TEXT_SEGMENTS = [
  { text: 'AICanDo', fill: null },
  { text: '.', fill: null },
  { text: 'X', fill: '#0ea5e9' },
  { text: 'Y', fill: '#84cc16' },
  { text: 'Z', fill: '#ec4899' },
] as const;

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

async function bitmapFromBytes(bytes: Uint8Array<ArrayBufferLike>, mimeType: string) {
  const blob = new Blob([Uint8Array.from(bytes)], { type: mimeType });
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    if (mimeType !== 'image/svg+xml') throw error;
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

function sourceBitmap(request: ImageDecoderRequest) {
  return bitmapFromBytes(request.sourceBytes, request.sourceMimeType);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function watermarkPosition(
  position: WatermarkRequest['position'],
  canvasWidth: number,
  canvasHeight: number,
  width: number,
  height: number,
  margin: number,
) {
  const availableWidth = Math.max(0, canvasWidth - margin * 2 - width);
  const availableHeight = Math.max(0, canvasHeight - margin * 2 - height);
  return {
    x: margin + Math.round(position.x * availableWidth),
    y: margin + Math.round(position.y * availableHeight),
  };
}

function sampledLuminance(
  context: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const pixels = context.getImageData(x, y, width, height).data;
  const step = Math.max(4, Math.floor(pixels.length / (512 * 4)) * 4);
  let count = 0;
  let sum = 0;
  let squared = 0;
  for (let offset = 0; offset < pixels.length; offset += step) {
    const alpha = pixels[offset + 3] / 255;
    const red = (pixels[offset] * alpha + 255 * (1 - alpha)) / 255;
    const green = (pixels[offset + 1] * alpha + 255 * (1 - alpha)) / 255;
    const blue = (pixels[offset + 2] * alpha + 255 * (1 - alpha)) / 255;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    sum += luminance;
    squared += luminance * luminance;
    count += 1;
  }
  const mean = count ? sum / count : 0.5;
  return { mean, variance: count ? Math.max(0, squared / count - mean * mean) : 0 };
}

function drawOutlinedText(
  context: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  fill: string,
  outline: string,
  outlineWidth: number,
) {
  context.lineJoin = 'round';
  context.lineWidth = outlineWidth;
  context.strokeStyle = outline;
  context.strokeText(text, x, baseline);
  context.fillStyle = fill;
  context.fillText(text, x, baseline);
}

function drawAicandoText(
  context: OffscreenCanvasRenderingContext2D,
  x: number,
  baseline: number,
  mainInk: string,
  outline: string,
  outlineWidth: number,
) {
  let cursor = x;
  for (const segment of AICANDO_TEXT_SEGMENTS) {
    drawOutlinedText(context, segment.text, cursor, baseline, segment.fill ?? mainInk, outline, outlineWidth);
    cursor += context.measureText(segment.text).width;
  }
}

function measuredWatermarkTextWidth(context: OffscreenCanvasRenderingContext2D, request: WatermarkRequest) {
  if (!request.text) return 0;
  if (request.style !== 'AICANDO_XYZ' || request.text !== 'AICanDo.XYZ') {
    return Math.ceil(context.measureText(request.text).width);
  }
  return Math.ceil(
    AICANDO_TEXT_SEGMENTS.reduce((width, segment) => width + context.measureText(segment.text).width, 0),
  );
}

function watermarkLayout(
  context: OffscreenCanvasRenderingContext2D,
  request: WatermarkRequest,
  logo: ImageBitmap,
  canvasWidth: number,
  canvasHeight: number,
) {
  const shortSide = Math.min(canvasWidth, canvasHeight);
  const baseLogoHeight = Math.max(8, Math.round(shortSide * request.sizeRatio));
  const baseFontSize = Math.max(6, Math.round(baseLogoHeight * 0.72));
  const baseGap = Math.max(5, Math.round(baseLogoHeight * 0.18));
  const basePaddingX = Math.max(6, Math.round(baseLogoHeight * 0.2));
  const basePaddingY = Math.max(4, Math.round(baseLogoHeight * 0.12));
  const baseMargin = clamp(Math.round(shortSide * 0.028), 10, 64);
  const measure = (scale: number) => {
    const logoHeight = Math.max(1, Math.floor(baseLogoHeight * scale));
    const logoWidth = Math.max(1, Math.round((logo.width / logo.height) * logoHeight));
    const fontSize = Math.max(1, Math.floor(baseFontSize * scale));
    const gap = Math.max(1, Math.floor(baseGap * scale));
    const paddingX = Math.max(1, Math.floor(basePaddingX * scale));
    const paddingY = Math.max(1, Math.floor(basePaddingY * scale));
    context.font = `700 ${fontSize}px "Segoe UI", Arial, sans-serif`;
    context.textBaseline = 'alphabetic';
    const textWidth = measuredWatermarkTextWidth(context, request);
    const contentHeight = request.text ? Math.max(logoHeight, Math.ceil(fontSize * 1.18)) : logoHeight;
    return {
      logoHeight,
      logoWidth,
      fontSize,
      gap,
      paddingX,
      paddingY,
      contentHeight,
      width: paddingX * 2 + logoWidth + (request.text ? gap + textWidth : 0),
      height: paddingY * 2 + contentHeight,
    };
  };

  const natural = measure(1);
  const scale = Math.min(1, (canvasWidth * 0.94) / natural.width, (canvasHeight * 0.94) / natural.height);
  const layout = measure(scale);
  if (
    layout.logoHeight < 8 ||
    (request.text.length > 0 && layout.fontSize < 6) ||
    layout.width > canvasWidth ||
    layout.height > canvasHeight
  ) {
    throw new Error('Image is too small to place a readable watermark');
  }
  const margin = Math.max(
    0,
    Math.min(
      Math.floor(baseMargin * scale),
      Math.floor((canvasWidth - layout.width) / 2),
      Math.floor((canvasHeight - layout.height) / 2),
    ),
  );
  return { ...layout, margin };
}

function drawNaturalWatermark(
  context: OffscreenCanvasRenderingContext2D,
  request: WatermarkRequest,
  logo: ImageBitmap,
  canvasWidth: number,
  canvasHeight: number,
) {
  const { logoHeight, logoWidth, fontSize, gap, paddingX, paddingY, contentHeight, width, height, margin } =
    watermarkLayout(context, request, logo, canvasWidth, canvasHeight);
  context.font = `700 ${fontSize}px "Segoe UI", Arial, sans-serif`;
  context.textBaseline = 'alphabetic';
  const origin = watermarkPosition(request.position, canvasWidth, canvasHeight, width, height, margin);
  const sample = sampledLuminance(context, origin.x, origin.y, width, height);
  const darkBackground = sample.mean < 0.5;
  const busyBackground = sample.variance > 0.045 || (sample.mean > 0.34 && sample.mean < 0.68);
  const mainInk = darkBackground ? 'rgba(255,255,255,0.96)' : 'rgba(18,20,23,0.94)';
  const outline = darkBackground ? 'rgba(8,10,12,0.42)' : 'rgba(255,255,255,0.58)';
  const outlineWidth = Math.max(1.25, fontSize * 0.055);

  context.save();
  context.globalAlpha = request.opacity;
  if (busyBackground) {
    context.beginPath();
    context.roundRect(origin.x, origin.y, width, height, Math.max(4, Math.round(height * 0.18)));
    context.fillStyle = darkBackground ? 'rgba(8,10,12,0.26)' : 'rgba(255,255,255,0.34)';
    context.fill();
    context.strokeStyle = darkBackground ? 'rgba(255,255,255,0.16)' : 'rgba(18,20,23,0.14)';
    context.lineWidth = 1;
    context.stroke();
  }

  const contentY = origin.y + paddingY + Math.round((contentHeight - logoHeight) / 2);
  const logoX = origin.x + paddingX;
  context.shadowColor = darkBackground ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.36)';
  context.shadowBlur = Math.max(2, Math.round(fontSize * 0.12));
  if (request.style === 'AIY') {
    context.save();
    context.beginPath();
    context.roundRect(logoX, contentY, logoWidth, logoHeight, Math.max(3, Math.round(logoHeight * 0.16)));
    context.clip();
    context.drawImage(logo, logoX, contentY, logoWidth, logoHeight);
    context.restore();
  } else {
    context.drawImage(logo, logoX, contentY, logoWidth, logoHeight);
  }

  if (request.text) {
    const textX = logoX + logoWidth + gap;
    const baseline = origin.y + paddingY + Math.round((contentHeight + fontSize * 0.72) / 2);
    if (request.style === 'AICANDO_XYZ' && request.text === 'AICanDo.XYZ') {
      drawAicandoText(context, textX, baseline, mainInk, outline, outlineWidth);
    } else {
      drawOutlinedText(context, request.text, textX, baseline, mainInk, outline, outlineWidth);
    }
  }
  context.restore();
}

async function watermarkOutput(canvas: OffscreenCanvas, sourceMimeType: WatermarkRequest['sourceMimeType']) {
  const preferred =
    sourceMimeType === 'image/jpeg'
      ? ('image/jpeg' as const)
      : sourceMimeType === 'image/webp'
        ? ('image/webp' as const)
        : ('image/png' as const);
  const candidates = preferred === 'image/webp' ? [preferred] : [preferred, 'image/webp' as const];
  try {
    for (const type of candidates) {
      const blob = await canvas.convertToBlob({ type, quality: type === 'image/png' ? undefined : 0.92 });
      if (blob.type !== type || !blob.size || blob.size > MAX_IMAGE_DECODER_WATERMARK_OUTPUT_BYTES) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength === blob.size) return { bytes, mimeType: type };
    }
    throw new Error('Watermarked image exceeds the transfer limit');
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function decodeRequest(request: ImageDecoderRequest): Promise<ImageDecoderSuccessResponse> {
  if (request.operation === 'watermark' && request.sourceMimeType === 'image/gif') {
    const logo = await bitmapFromBytes(request.logoBytes, request.logoMimeType);
    try {
      assertSafeDimensions(logo.width, logo.height);
      const output = watermarkGif(request.sourceBytes, (context, width, height) =>
        drawNaturalWatermark(context, request, logo, width, height),
      );
      return {
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        outputBytes: output.bytes,
        outputMimeType: 'image/gif',
        width: output.width,
        height: output.height,
        sourceWidth: output.width,
        sourceHeight: output.height,
      };
    } finally {
      logo.close();
    }
  }
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

    if (request.operation === 'watermark') {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Chromium canvas is unavailable');
      context.drawImage(bitmap, 0, 0);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      bitmap = null;

      let logo: ImageBitmap | null = await bitmapFromBytes(request.logoBytes, request.logoMimeType);
      try {
        assertSafeDimensions(logo.width, logo.height);
        drawNaturalWatermark(context, request, logo, width, height);
      } finally {
        logo.close();
        logo = null;
      }
      const output = await watermarkOutput(canvas, request.sourceMimeType);
      return {
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        outputBytes: output.bytes,
        outputMimeType: output.mimeType,
        width,
        height,
        sourceWidth,
        sourceHeight,
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
