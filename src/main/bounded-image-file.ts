import { lstat, open } from 'node:fs/promises';
import { MAX_IMAGE_DECODER_INPUT_BYTES } from '@/shared/image-decoder-protocol';

function isSameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>) {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function readBoundedImageFile(filePath: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAX_IMAGE_DECODER_INPUT_BYTES) {
    throw new Error(`Image must be between 1 byte and ${MAX_IMAGE_DECODER_INPUT_BYTES} bytes`);
  }
  const handle = await open(filePath, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !isSameFile(before, opened) || opened.size !== before.size) {
      throw new Error('Image changed before it could be read');
    }
    const bytes = await handle.readFile({ signal });
    const afterRead = await handle.stat();
    const afterPath = await lstat(filePath);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      !isSameFile(opened, afterRead) ||
      !isSameFile(opened, afterPath) ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.ctimeMs !== opened.ctimeMs ||
      bytes.byteLength !== opened.size
    ) {
      throw new Error('Image changed while it was being read');
    }
    signal?.throwIfAborted();
    return bytes;
  } finally {
    await handle.close();
  }
}
