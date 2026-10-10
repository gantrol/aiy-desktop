import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, unlink, stat } from 'node:fs/promises';
import path from 'node:path';

export function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export async function readJson(file: string, limit = 32 * 1024 * 1024): Promise<unknown> {
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    if (size > limit) throw new Error('JSON_SIZE_LIMIT');
    const data = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, Math.min(1024 * 1024, data.length - offset), offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== size) throw new Error('JSON_CHANGED_DURING_READ');
    return JSON.parse(data.subarray(0, offset).toString('utf8'));
  } finally {
    await handle.close();
  }
}
export async function hashFile(file: string, limit = 2 * 1024 ** 3) {
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit) throw new Error('FILE_SIZE_LIMIT');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024 })) {
      bytes += chunk.length;
      if (bytes > limit) throw new Error('FILE_SIZE_LIMIT');
      hash.update(chunk);
    }
    const after = await stat(file);
    if (before.size !== bytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('SOURCE_CHANGED');
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
/** Publish once on a local filesystem; existing frozen inputs can never be overwritten. */
export async function writeNewJson(file: string, value: unknown) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
    await handle.close();
    await link(temporary, file);
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}
