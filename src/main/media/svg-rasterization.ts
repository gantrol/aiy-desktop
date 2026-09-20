import { lstat } from 'node:fs/promises';
import { validateCanvasPngAsync } from '@/main/media/png-validation';
import { withDecodedImageBytesInSandbox, withDecodedImageFileInSandbox } from '@/main/media/sandboxed-image-decoder';
import type { ImageDecoderSuccessResponse } from '@/shared/image-decoder-protocol';

const maximumSvgBytes = 25 * 1024 * 1024;
const maximumRasterBytes = 25 * 1024 * 1024;

export interface RasterizedSvg {
  bytes: Buffer;
  width: number;
  height: number;
}

function bufferView(bytes: Uint8Array<ArrayBufferLike>) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function validatedRaster(result: ImageDecoderSuccessResponse): Promise<RasterizedSvg> {
  if (result.operation !== 'normalize') throw new Error('SVG decoder returned the wrong operation');
  const bytes = bufferView(result.pngBytes);
  if (!bytes.byteLength || bytes.byteLength > maximumRasterBytes) {
    throw new Error('Rasterized SVG must be 25 MB or smaller');
  }
  const structure = await validateCanvasPngAsync(bytes);
  if (!structure || structure.width !== result.width || structure.height !== result.height) {
    throw new Error('Rasterized SVG output is invalid');
  }
  return { bytes, width: structure.width, height: structure.height };
}

export async function rasterizeSvgBytesInSandbox(bytes: Uint8Array<ArrayBufferLike>, signal?: AbortSignal) {
  if (!bytes.byteLength || bytes.byteLength > maximumSvgBytes) throw new Error('SVG must be 25 MB or smaller');
  return withDecodedImageBytesInSandbox(
    bytes,
    'image/svg+xml',
    { operation: 'normalize' },
    validatedRaster,
    undefined,
    signal,
  );
}

export async function rasterizeSvgFileInSandbox(filePath: string) {
  const source = await lstat(filePath);
  if (!source.isFile() || source.isSymbolicLink() || source.size < 1 || source.size > maximumSvgBytes) {
    throw new Error('SVG must be 25 MB or smaller');
  }
  return withDecodedImageFileInSandbox(filePath, { operation: 'normalize' }, validatedRaster);
}
