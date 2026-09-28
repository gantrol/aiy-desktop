import { validateCanvasPngAsync } from '@/main/media/png-validation';
import { withDecodedImageFileInSandbox } from '@/main/media/sandboxed-image-decoder';
import { writeThumbnailPng } from '@/main/media/write-thumbnail-png';

function bufferView(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function createThumbnailInSandbox(
  sourcePath: string,
  outputPath: string,
  size: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  return withDecodedImageFileInSandbox(
    sourcePath,
    { operation: 'thumbnail', size },
    async (result) => {
      if (result.operation !== 'thumbnail') throw new Error('Image decoder returned the wrong operation');
      const structure = await validateCanvasPngAsync(bufferView(result.pngBytes));
      if (
        !structure ||
        structure.width !== result.width ||
        structure.height !== result.height ||
        result.width > size ||
        result.height > size
      ) {
        throw new Error('Image thumbnail output does not match its reported PNG dimensions');
      }
      return writeThumbnailPng(outputPath, result.pngBytes, signal);
    },
    120_000,
    signal,
  );
}
