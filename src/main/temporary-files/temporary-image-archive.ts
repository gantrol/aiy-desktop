import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import type { ImageEditRecord } from '@/shared/contracts/image-edit';
import type { TemporaryFilesStore } from '@/main/temporary-files/temporary-files-store';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { petalError } from '@/shared/petal-errors';

/** Promotion keeps a self-contained original and recipe even before the library editor is connected.
 * The original is not a gallery asset, so unrelated gallery deletion cannot break this archive.
 */
export async function archiveTemporaryImageEdit(
  store: TemporaryFilesStore,
  id: string,
  libraryRoot: string,
  record: ImageEditRecord,
  resultAssetId: string,
) {
  const source = store.manifest(id).attachments.find((file) => file.id === record.sourceAssetId);
  if (!source?.asset || record.draft) throw petalError('unsaved');
  const directory = path.join(libraryRoot, 'image-edits', id);
  await mkdir(directory, { recursive: true });
  const sourceFile = `${record.sourceAssetId}${source.extension ?? '.bin'}`;
  await atomicArchiveFile(
    directory,
    sourceFile,
    await readBoundedImageFile(store.file(source.id, 'bin'), undefined, 25 * 1024 * 1024),
  );
  await atomicArchiveFile(
    directory,
    'record.json',
    JSON.stringify({
      version: 1,
      ...record,
      resultAssetId,
      sourceFile,
      sourceMimeType: source.mimeType,
      sourceHash: source.hash,
    }),
  );
}

async function atomicArchiveFile(directory: string, name: string, value: string | Uint8Array) {
  const pending = path.join(directory, `${randomUUID()}.pending`);
  await writeFile(pending, value, { flag: 'wx', flush: true });
  try {
    await rename(pending, path.join(directory, name));
  } finally {
    await unlink(pending).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
