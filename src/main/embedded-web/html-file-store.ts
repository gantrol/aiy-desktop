import { randomUUID } from 'node:crypto';
import { link, lstat, open, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readablePath } from '@/main/database/assets/readable-content-paths';
import { sha256HexAsync } from '@/main/database/core/storage';
import { htmlFileByteLimit, htmlFileHashSchema } from '@/shared/contracts/html-file';

async function objectPath(root: string, hash: string, create = false) {
  htmlFileHashSchema.parse(hash);
  const directory = await readablePath(root, `objects/sha256/${hash.slice(0, 2)}`, create);
  return path.join(directory, `${hash}.html`);
}

/** Immutable objects are retained with document revisions, including undo and fixed references. */
export async function storeHtmlFile(root: string, bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > htmlFileByteLimit) throw new Error('HTML_FILE_TOO_LARGE');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (source.includes('\0')) throw new Error('HTML_FILE_INVALID');
  const hash = await sha256HexAsync(bytes);
  const target = await objectPath(root, hash, true);
  const temporary = path.join(path.dirname(target), `.html-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx', flush: true });
    try {
      // Publishing a complete inode avoids exposing a partial object after a crash.
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await readHtmlFile(root, hash);
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return hash;
}

export async function readHtmlFile(root: string, hash: string) {
  const target = await objectPath(root, hash);
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || !before.size || before.size > htmlFileByteLimit)
    throw new Error('HTML_FILE_UNAVAILABLE');
  const handle = await open(target, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
      throw new Error('HTML_FILE_UNAVAILABLE');
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const result = bytes.subarray(0, length);
    if (length !== before.size || (await sha256HexAsync(result)) !== hash) throw new Error('HTML_FILE_UNAVAILABLE');
    return result;
  } finally {
    await handle.close();
  }
}
