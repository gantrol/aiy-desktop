import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCanvasPngAsync } from '@/main/media/png-validation';
import { withDecodedImageFileInSandbox } from '@/main/media/sandboxed-image-decoder';

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
  const temporaryOutputPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(outputPath), { recursive: true });

  try {
    return await withDecodedImageFileInSandbox(
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
        signal?.throwIfAborted();
        await writeFile(temporaryOutputPath, result.pngBytes);
        signal?.throwIfAborted();
        await rename(temporaryOutputPath, outputPath);
        return outputPath;
      },
      120_000,
      signal,
    );
  } finally {
    await rm(temporaryOutputPath, { force: true });
  }
}
