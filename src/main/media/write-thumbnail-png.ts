import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Native and sandbox decoders share one publication boundary; PNG validation
// belongs to the decoder, not this filesystem operation.
export async function writeThumbnailPng(outputPath: string, pngBytes: Uint8Array, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, pngBytes, { signal });
    signal?.throwIfAborted();
    await rename(temporaryPath, outputPath);
    // A rename already in progress cannot be cancelled. Keep a complete cache
    // file, but do not report success to a caller whose lifetime has ended.
    signal?.throwIfAborted();
    return outputPath;
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Thumbnail publication and temporary-file cleanup failed');
    }
    throw error;
  }
}
