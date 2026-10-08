import { randomUUID } from 'node:crypto';
import { copyFile } from 'node:fs/promises';
import { dialog, shell } from 'electron';
import { contentImageImportIdSchema, contentImageStageSchema } from '@/shared/contracts/content-image-import';
import { desktopNoteSchema, petalReferenceCommandSchema, type DesktopNote } from '@/shared/contracts/desktop-petals';
import type { PinSummary } from '@/shared/contracts/petal-board';
import { noteFileCommandSchema } from '@/shared/contracts/note-files';
import { contentLibraryCommandSchema } from '@/shared/contracts/content-library';
import { petalAssetFileCommandSchema } from '@/shared/contracts/petal-workspace';
import type { TemporaryFilesStore } from '@/main/temporary-files/temporary-files-store';
import { stageTemporaryImage } from '@/main/temporary-files/temporary-file-images';
import { noteFileMetadata } from '@/main/desktop-petals/note-file-store';
import { copyImageInSandbox } from '@/main/media/image-clipboard-worker-client';
import { linkPreviews, openLinkCard } from '@/main/links/link-preview-service';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import { petalError } from '@/shared/petal-errors';

export async function executeTemporaryContent(
  store: TemporaryFilesStore,
  id: string,
  command: string,
  input: unknown,
  entry: PetalWindow,
) {
  if (command === 'content-image-stage')
    return void (await stageTemporaryImage(store, id, contentImageStageSchema.parse(input)));
  if (command === 'content-image-resolve' || command === 'content-image-accepted') {
    const asset = store
      .manifest(id)
      .attachments.find((file) => file.id === contentImageImportIdSchema.parse(input))?.asset;
    if (command === 'content-image-accepted') return Boolean(asset);
    if (!asset) throw petalError('sourceUnavailable');
    return asset;
  }
  if (command === 'files') return files(store, id, input);
  if (command === 'references') return references(store, id, input, entry);
  if (command === 'asset-file') return assetFile(store, id, input, entry);
  if (command === 'content-library') {
    const request = contentLibraryCommandSchema.parse(input);
    if (request.kind === 'link-preview') return linkPreviews.get(request.url, request.refresh);
    if (request.kind === 'link-open') return openLinkCard(request.url);
    throw petalError('temporaryChooseSpace');
  }
  throw petalError('invalidSettings');
}

async function files(store: TemporaryFilesStore, id: string, input: unknown) {
  const request = noteFileCommandSchema.parse(input);
  if (request.id !== id) throw petalError('sourceUnavailable');
  const body = await store.body(id);
  if (request.kind === 'open') {
    const file = body.note.files?.find((item) => item.id === request.fileId);
    if (!file) throw petalError('sourceUnavailable');
    const error = await shell.openPath(store.file(file.id, 'bin'));
    if (error) throw petalError('sourceUnavailable');
    return body.note;
  }
  if (body.note.contentHash !== request.expectedHash || body.draft) throw petalError('unsaved');
  let next = body.note.files ?? [];
  if (request.kind === 'import') {
    const file = await noteFileMetadata(request.name, request.bytes);
    await store.attach(id, { ...file, file }, request.bytes);
    next = [...next, file];
  } else next = next.filter((file) => file.id !== request.fileId);
  const note = { ...body.note, files: next, contentHash: randomUUID() };
  await store.commit({ ...store.manifest(id), protected: true }, { ...body, note, draft: null });
  return note;
}

async function references(
  store: TemporaryFilesStore,
  id: string,
  input: unknown,
  entry: PetalWindow,
): Promise<DesktopNote | PinSummary[]> {
  const request = petalReferenceCommandSchema.parse(input);
  if (request.id !== id) throw petalError('sourceUnavailable');
  if (request.kind === 'search') return [];
  if (request.kind === 'add') throw petalError('temporaryChooseSpace');
  const body = await store.body(id);
  if (body.note.contentHash !== request.expectedHash || body.draft) throw petalError('unsaved');
  const importedImages = [];
  let references = body.note.references;
  if (request.kind === 'upload') {
    const result = await dialog.showOpenDialog(entry.window, {
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (result.canceled || !result.filePaths[0]) return body.note;
    const source = await realpath(result.filePaths[0]);
    if (/trash/i.test(source) || /trash/i.test(result.filePaths[0])) throw petalError('sourceUnavailable');
    const mimeType = (
      {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      } as const
    )[path.extname(source).toLowerCase() as '.png'];
    return referencesFromUpload(
      store,
      id,
      request.expectedHash,
      { name: path.basename(source), mimeType, bytes: await readBoundedImageFile(source, undefined, 25 * 1024 * 1024) },
      entry,
    );
  }
  if (request.kind === 'import') {
    for (const item of request.items)
      importedImages.push(
        await stageTemporaryImage(store, id, { importId: randomUUID(), source: request.source, item }),
      );
    references = [...references, ...importedImages.map((asset) => ({ assetId: asset.id, mediaUrl: asset.mediaUrl }))];
  } else references = references.filter((item) => item.assetId !== request.assetId);
  const note = { ...body.note, references, contentHash: randomUUID() };
  await store.commit({ ...store.manifest(id), protected: true }, { ...body, note, draft: null });
  return desktopNoteSchema.parse({ ...note, importedImages });
}

function referencesFromUpload(
  store: TemporaryFilesStore,
  id: string,
  expectedHash: string,
  item: { name: string; mimeType: string; bytes: Uint8Array },
  entry: PetalWindow,
) {
  return references(store, id, { kind: 'import', id, expectedHash, source: 'UPLOAD', items: [item] }, entry);
}

async function assetFile(store: TemporaryFilesStore, id: string, input: unknown, entry: PetalWindow) {
  const request = petalAssetFileCommandSchema.parse(input);
  const file = store.manifest(id).attachments.find((item) => item.id === request.assetId && item.asset);
  if (!file) throw petalError('sourceUnavailable');
  const source = store.file(file.id, 'bin');
  if (request.action === 'copy') await copyImageInSandbox(source);
  else if (request.action === 'reveal') shell.showItemInFolder(source);
  else if (request.action === 'open') {
    if (await shell.openPath(source)) throw petalError('sourceUnavailable');
  } else {
    const result = await dialog.showSaveDialog(entry.window, {
      defaultPath: file.name,
      properties: ['showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    if (/trash/i.test(result.filePath)) throw petalError('sourceUnavailable');
    await copyFile(source, result.filePath);
    return { status: 'saved' };
  }
  return { status: 'done' };
}
