import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { GifReader, type GifFrameInfo } from 'omggif';
import { gifMetadata } from '@/shared/gif-metadata';
import {
  MAX_IMAGE_DECODER_DIMENSION,
  MAX_IMAGE_DECODER_GIF_FRAMES,
  MAX_IMAGE_DECODER_GIF_TOTAL_PIXELS,
  MAX_IMAGE_DECODER_PIXELS,
  MAX_IMAGE_DECODER_WATERMARK_OUTPUT_BYTES,
} from '@/shared/image-decoder-protocol';

function clearFrame(pixels: Uint8ClampedArray, canvasWidth: number, frame: GifFrameInfo) {
  for (let y = frame.y; y < frame.y + frame.height; y++) {
    const start = (y * canvasWidth + frame.x) * 4;
    pixels.fill(0, start, start + frame.width * 4);
  }
}

export function watermarkGif(
  sourceBytes: Uint8Array,
  drawWatermark: (context: OffscreenCanvasRenderingContext2D, width: number, height: number) => void,
) {
  const metadata = gifMetadata(sourceBytes, {
    requireFullCanvasFrames: false,
    maxFrames: MAX_IMAGE_DECODER_GIF_FRAMES,
  });
  const { width, height, durations, loop } = metadata;
  const pixelCount = width * height;
  if (
    width > MAX_IMAGE_DECODER_DIMENSION ||
    height > MAX_IMAGE_DECODER_DIMENSION ||
    pixelCount > MAX_IMAGE_DECODER_PIXELS ||
    pixelCount * durations.length > MAX_IMAGE_DECODER_GIF_TOTAL_PIXELS
  ) {
    throw new Error('Animated GIF dimensions exceed the safety limit');
  }
  const reader = new GifReader(sourceBytes);
  if (reader.width !== width || reader.height !== height || reader.numFrames() !== durations.length) {
    throw new Error('Animated GIF frame metadata is inconsistent');
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Chromium canvas is unavailable');
  const pixels = new Uint8ClampedArray(pixelCount * 4);
  const image = new ImageData(pixels, width, height);
  const encoder = GIFEncoder();
  try {
    for (let i = 0; i < durations.length; i++) {
      const frame = reader.frameInfo(i);
      const control = metadata.controls[i];
      // omggif carries graphics controls forward even when the next frame has no control extension.
      frame.transparent_index = control.transparentIndex;
      const previous = control.disposal === 3 ? pixels.slice() : null;
      reader.decodeAndBlitFrameRGBA(i, pixels);
      // Keep the unwatermarked composition separate so partial frames never accumulate watermarks.
      context.putImageData(image, 0, 0);
      drawWatermark(context, width, height);
      const rgba = context.getImageData(0, 0, width, height).data;
      const opaquePalette = quantize(rgba, 255, { format: 'rgb565' });
      const index = applyPalette(rgba, opaquePalette, 'rgb565');
      for (let pixel = 0; pixel < pixelCount; pixel++) {
        index[pixel] = rgba[pixel * 4 + 3] < 128 ? 0 : index[pixel] + 1;
      }
      encoder.writeFrame(index, width, height, {
        palette: [[0, 0, 0], ...opaquePalette],
        delay: durations[i],
        repeat: loop ?? -1,
        transparent: true,
        transparentIndex: 0,
        dispose: 2,
      });
      if (encoder.bytesView().length > MAX_IMAGE_DECODER_WATERMARK_OUTPUT_BYTES) {
        throw new Error('Watermarked GIF exceeds the transfer limit');
      }
      // Full-canvas output frames use disposal 2; source frames retain their own disposal semantics.
      if (previous) pixels.set(previous);
      else if (control.disposal === 2) clearFrame(pixels, width, frame);
    }
    encoder.finish();
    if (encoder.bytesView().length > MAX_IMAGE_DECODER_WATERMARK_OUTPUT_BYTES) {
      throw new Error('Watermarked GIF exceeds the transfer limit');
    }
    return { bytes: Uint8Array.from(encoder.bytesView()), width, height };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
