import path from 'node:path';
import { chmod, copyFile } from 'node:fs/promises';
import { app, dialog, shell } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import { AssetFileActions } from '@/main/media/asset-file-actions';
import { beginAssetExportCalendar } from '@/main/media/asset-export-calendar';
import { copyImageInSandbox } from '@/main/media/image-clipboard-worker-client';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { petalAssetFileCommandSchema, type PetalAssetFileResult } from '@/shared/contracts/petal-workspace';
import { noteAssetIds, requirePetalAsset } from '@/shared/petal-asset-scope';
import { petalError } from '@/shared/petal-errors';

/** The controller has already checked the IPC sender and acquired the library operation guard. */
export async function executePetalAssetFile(
  context: ActiveLibraryContext,
  raw: unknown,
  entry: PetalWindow | undefined,
  notes: PetalNoteService,
  board: PetalBoardService,
): Promise<PetalAssetFileResult> {
  const request = petalAssetFileCommandSchema.parse(raw);
  const requireScope = () => {
    if (
      !entry?.instanceId ||
      entry.libraryId !== context.library.id ||
      context.state !== 'ACTIVE' ||
      entry.window.isDestroyed()
    )
      throw petalError('sourceUnavailable');
    if (isContentPinId(entry.instanceId)) {
      const pin = board.snapshot().pins.find((item) => item.id === entry.instanceId);
      const assetId = pin?.media?.id ?? (pin?.source.kind === 'IMAGE' ? pin.source.id : undefined);
      requirePetalAsset(request.assetId, new Set(assetId ? [assetId] : []));
    } else requirePetalAsset(request.assetId, noteAssetIds(notes.get(entry.instanceId)));
  };
  requireScope();
  const database = context.database;
  const actions = new AssetFileActions(
    (assetId) => {
      requireScope();
      return database.resolveAssetFile(assetId);
    },
    {
      showSaveDialog: (options) => {
        requireScope();
        const localized = {
          ...options,
          defaultPath: path.join(app.getPath('downloads'), path.basename(options.defaultPath || 'AIY')),
        };
        return dialog.showSaveDialog(entry!.window, localized);
      },
      copyFile: async (source, destination) => {
        requireScope();
        await copyFile(source, destination);
        await chmod(destination, 0o644);
      },
      copyImage: (file) => {
        requireScope();
        return copyImageInSandbox(file);
      },
      showItemInFolder: (file) => {
        requireScope();
        shell.showItemInFolder(file);
      },
      openPath: (file) => {
        requireScope();
        return shell.openPath(file);
      },
    },
    async (asset) => {
      requireScope();
      const targets = await database.listAssetRevealTargets(asset.assetId);
      const readable = await database.resolveAssetRevealPathAsync(asset.assetId, targets[0]?.context);
      requireScope();
      if (!readable) throw petalError('sourceUnavailable');
      return readable;
    },
    (assetId) => beginAssetExportCalendar(database, assetId),
  );
  if (request.action === 'save-as') return actions.saveAs(request.assetId);
  if (request.action === 'copy') await actions.copy(request.assetId);
  else if (request.action === 'open') await actions.open(request.assetId);
  else await actions.reveal(request.assetId);
  return { status: 'done' };
}
