import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import { recordCalendarCapturedEvents } from '@/main/database/calendar/calendar-file-capture';

type ExportDatabase = Pick<LibraryDatabase, 'db' | 'libraryRoot'>;
const receiptSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    libraryId: z.string().min(1).max(500),
    entityId: z.string().min(1).max(500),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();
type Receipt = z.infer<typeof receiptSchema>;
const pending = new Map<string, Map<string, Receipt>>();
const directoryFor = (root: string) => path.join(root, 'calendar-receipts', 'asset-exports');
const receiptFile = (root: string, id: string) => path.join(directoryFor(root), `${id}.json`);
function libraryId(database: ExportDatabase) {
  const id = database.db.prepare('SELECT id FROM local_spaces WHERE singleton_key=1').pluck().get();
  if (typeof id !== 'string' || !id) throw new Error('Export calendar library is unavailable');
  return id;
}
function retain(root: string, receipt: Receipt) {
  let entries = pending.get(root);
  if (!entries) pending.set(root, (entries = new Map()));
  entries.set(receipt.id, receipt);
}
async function persist(root: string, receipt: Receipt) {
  const directory = directoryFor(root);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `${receipt.id}.pending-${randomUUID()}`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(receipt), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, receiptFile(root, receipt.id));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
async function record(database: ExportDatabase, receipt: Receipt) {
  if (libraryId(database) !== receipt.libraryId) return false;
  recordCalendarCapturedEvents(database.db, [
    {
      id: receipt.id,
      entityType: 'IMAGE_ASSET',
      entityId: receipt.entityId,
      operation: 'EXPORT',
      observedAt: receipt.observedAt,
    },
  ]);
  // A crash or failed acknowledgement leaves the same UUID for an idempotent replay.
  await unlink(receiptFile(database.libraryRoot, receipt.id)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  pending.get(database.libraryRoot)?.delete(receipt.id);
  if (!pending.get(database.libraryRoot)?.size) pending.delete(database.libraryRoot);
  return true;
}

/** Capture concrete connection/root values before the first dialog await can change a live proxy. */
export function beginAssetExportCalendar(database: ExportDatabase, assetId: string): () => Promise<void> {
  const owner = { db: database.db, libraryRoot: database.libraryRoot };
  const ownerId = libraryId(owner);
  let receipt: Receipt | undefined;
  return async () => {
    // Called only after the copy port confirms success, including its file-mode update.
    receipt ??= receiptSchema.parse({
      version: 1,
      id: randomUUID(),
      libraryId: ownerId,
      entityId: assetId,
      observedAt: new Date().toISOString(),
    });
    retain(owner.libraryRoot, receipt);
    try {
      await persist(owner.libraryRoot, receipt);
    } catch {
      console.warn('[calendar] Export receipt could not be persisted; retaining it for this session');
    }
    try {
      await record(owner, receipt);
    } catch {
      console.warn('[calendar] Export succeeded; its calendar receipt is awaiting replay');
    }
  };
}

/** Activation retries only explicit successful-copy receipts; it never guesses exports from arbitrary files. */
export async function replayAssetExportCalendar(database: ExportDatabase): Promise<void> {
  // Detach from the dynamic facade even if the caller is not inside an IPC library lease.
  const owner = { db: database.db, libraryRoot: database.libraryRoot };
  try {
    const ownerId = libraryId(owner);
    const files = await readdir(directoryFor(owner.libraryRoot), { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    for (const file of files) {
      if (!file.isFile() || !/^[0-9a-f-]{36}\.json$/i.test(file.name)) continue;
      try {
        const handle = await open(path.join(directoryFor(owner.libraryRoot), file.name), 'r');
        let receipt: Receipt;
        try {
          const info = await handle.stat();
          if (info.size > 4096 || !info.isFile()) continue;
          receipt = receiptSchema.parse(JSON.parse(await handle.readFile('utf8')));
        } finally {
          await handle.close();
        }
        if (receipt.libraryId === ownerId && `${receipt.id}.json` === file.name) retain(owner.libraryRoot, receipt);
      } catch {
        console.warn('[calendar] An export receipt could not be read; it was retained unchanged');
      }
    }
    for (const receipt of [...(pending.get(owner.libraryRoot)?.values() ?? [])]) {
      if (receipt.libraryId !== ownerId) continue;
      try {
        // Also make session-only receipts durable before retrying an unavailable database.
        await persist(owner.libraryRoot, receipt).catch(() => undefined);
        await record(owner, receipt);
      } catch {
        console.warn('[calendar] An export receipt is still awaiting replay');
      }
    }
  } catch {
    console.warn('[calendar] Export receipt replay will resume on a later activation');
  }
}
