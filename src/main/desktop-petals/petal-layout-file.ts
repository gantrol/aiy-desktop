import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

// The reader and writer must agree. Older writers could create files larger
// than the old 1 MiB read limit, making the entire petal controller unavailable.
export const MAX_PETAL_LAYOUT_BYTES = 16 * 1_048_576;

async function readCandidate<T>(file: string, parse: (value: unknown) => T): Promise<T | undefined> {
  const handle = await open(file, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!handle) return undefined;
  let invalid = false;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('Desktop petal settings must be a regular file');
    if (stats.size > MAX_PETAL_LAYOUT_BYTES) invalid = true;
    else {
      // Filesystem failures are not corruption: do not replace an unreadable file.
      const content = await handle.readFile('utf8');
      try {
        if (Buffer.byteLength(content, 'utf8') > MAX_PETAL_LAYOUT_BYTES) throw new Error('Layout too large');
        return parse(JSON.parse(content));
      } catch {
        invalid = true;
      }
    }
  } finally {
    await handle.close();
  }
  if (invalid) {
    // Preserve the original bytes before permitting any default-state writes.
    // Failure to preserve them is fatal rather than silently discarding a layout.
    const recovery = `${file}.recovery-${randomUUID()}`;
    await rename(file, recovery);
    console.warn('[desktop-petals] invalid layout preserved', { recovery });
  }
  return undefined;
}

export async function readPetalLayoutFile<T>(file: string, parse: (value: unknown) => T): Promise<T | undefined> {
  const primary = await readCandidate(file, parse);
  if (primary !== undefined) return primary;
  const backup = await readCandidate(`${file}.bak`, parse);
  if (backup !== undefined) console.warn('[desktop-petals] layout restored from backup');
  return backup;
}

async function preserveBackup(file: string, pending: string) {
  try {
    await copyFile(file, pending);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const handle = await open(pending, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  // A failed copy or sync must not truncate the last usable backup.
  await rename(pending, `${file}.bak`);
}

/** Called through PetalLayoutStore's serial write queue. */
export async function writePetalLayoutFile(file: string, value: unknown): Promise<void> {
  // Capture one immutable serialization before any asynchronous work.
  const content = JSON.stringify(value);
  if (content === undefined || Buffer.byteLength(content, 'utf8') > MAX_PETAL_LAYOUT_BYTES)
    throw new Error('Desktop petal settings exceed the size limit');
  await mkdir(path.dirname(file), { recursive: true });
  const pending = `${file}.pending-${randomUUID()}`;
  const backupPending = `${pending}.bak`;
  const handle = await open(pending, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await preserveBackup(file, backupPending);
    await rename(pending, file);
  } finally {
    // Keep the original write error if cleanup also fails.
    await unlink(pending).catch(() => undefined);
    await unlink(backupPending).catch(() => undefined);
  }
}
