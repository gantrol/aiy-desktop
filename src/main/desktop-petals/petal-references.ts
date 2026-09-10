import { dialog, type BrowserWindow } from 'electron';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { CreatorImageStagingService } from '@/main/creations/creator-image-staging';
import type { LibraryDatabase } from '@/main/database';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalReferenceCommand } from '@/shared/contracts/desktop-petals';
import { petalError } from '@/shared/petal-errors';

export async function changePetalReferences(
  database: LibraryDatabase,
  notes: PetalNoteService,
  input: PetalReferenceCommand,
  imageLabel: string,
  window?: BrowserWindow,
) {
  const current = notes.get(input.id);
  if (input.kind === 'search')
    return database.petalBoard.search({ kind: 'IMAGE', query: input.query, offset: input.offset });
  if (!current.editable || current.contentHash !== input.expectedHash) throw petalError('unsaved');
  const update = (ids: string[]) => {
    const unique = [...new Set(ids)];
    if (unique.length > 100 && unique.length >= current.references.length) throw petalError('invalidSettings');
    return notes.references(current.id, input.expectedHash, unique);
  };
  const ids = current.references.map((reference) => reference.assetId);
  if (input.kind === 'remove') return update(ids.filter((id) => id !== input.assetId));
  if (input.kind === 'add') return update([...ids, input.assetId]);
  const stages = new CreatorImageStagingService(() => database);
  const attach = async (rows: Awaited<ReturnType<CreatorImageStagingService['stageItems']>>) => {
    const stageIds = rows.flatMap((row) => row.item.stageId ?? []);
    try {
      if (rows.some((row) => row.state === 'INVALID')) throw petalError('sourceUnavailable');
      return await stages.consume(stageIds, (db, images) =>
        db.db.transaction(() => {
          const assets = db.importStoredCreatorReferences(input.kind === 'import' ? input.source : 'UPLOAD', images);
          return {
            ...update([...ids, ...assets.map((asset) => asset.id)]),
            importedImages: assets.map(({ id, mediaUrl, mimeType, width, height, byteSize }) => ({
              id,
              mediaUrl,
              mimeType,
              width,
              height,
              byteSize,
            })),
          };
        })(),
      );
    } finally {
      await stages.discard(stageIds);
    }
  };
  if (input.kind === 'import') {
    if (input.items.length + ids.length > 100) throw petalError('invalidSettings');
    return attach(await stages.stageItems(input.items.map((item) => ({ ...item, id: randomUUID() }))));
  }
  const options = {
    properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
    filters: [{ name: imageLabel, extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  };
  const selection = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (selection.canceled || !selection.filePaths.length) return notes.get(input.id);
  if (selection.filePaths.length + ids.length > 100) throw petalError('invalidSettings');
  for (const file of selection.filePaths) {
    if (/trash/i.test(file) || /trash/i.test(await realpath(file))) throw petalError('sourceUnavailable');
  }
  return attach(await stages.stageFiles(selection.filePaths));
}
