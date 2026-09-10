import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type { AssetFileActions } from '@/main/media/asset-file-actions';
import { createAssetFileDragIcon } from '@/main/media/asset-file-drag-icon';
import { createTransitionShowcaseExportImages } from '@/main/media/transition-showcase-export-images';
import { transitionShowcaseExportImageIdsSchema } from '@/shared/contracts/transition-showcase';
import {
  assetFileDragRequestSchema,
  assetFileDragResultSchema,
  assetFilesDragFinishedChannel,
  assetFilesStartDragChannel,
} from '@/shared/contracts/asset-file-drag';
import {
  assetFileRevealContextSchema,
  assetFileRevealTargetContextSchema,
  galleryListSchema,
  id,
  imageRatingDimensionSchema,
  imageRatingScoreSchema,
  localeSchema,
  materialAlbumTargetSchema,
} from '@/main/ipc/schemas';

export function registerAssetIpc(
  ipcMain: IpcHandlerRegistrar,
  database: LibraryDatabase,
  assetFiles: AssetFileActions,
  onTransitionPreviewSelectionChanged: () => void = () => undefined,
) {
  ipcMain.handle('gallery:list', (_event, raw) => database.listGallery(galleryListSchema.parse(raw)));
  ipcMain.handle('asset-relationship:get', (_event, rawId, rawLocale) =>
    database.getAssetRelationship(id.parse(rawId), localeSchema.parse(rawLocale)),
  );
  ipcMain.handle('asset-file:availability', (_event, rawId) => assetFiles.availability(id.parse(rawId)));
  ipcMain.handle('asset-file:copy', (_event, rawId) => assetFiles.copy(id.parse(rawId)));
  ipcMain.handle('asset-file:save-as', (_event, rawId) => assetFiles.saveAs(id.parse(rawId)));
  ipcMain.on(assetFilesStartDragChannel, (event, rawRequest) => {
    const parsedRequest = assetFileDragRequestSchema.safeParse(rawRequest);
    if (!parsedRequest.success) return;
    const request = parsedRequest.data;
    try {
      // Keep paths inside the trusted main process: the renderer supplies stable
      // asset IDs, and every source is re-resolved and revalidated at drag time.
      const sources = request.assetIds.map((assetId) => {
        const source = database.resolveAssetFile(assetId);
        if (!source || !source.mimeType.startsWith('image/')) throw new Error('Image file is unavailable');
        return source;
      });
      const files = [...new Set(sources.map((source) => source.absolutePath))];
      const icon = createAssetFileDragIcon(files[0]);
      event.sender.startDrag(files.length === 1 ? { file: files[0], icon } : { file: files[0], files, icon });
      if (!event.sender.isDestroyed()) {
        event.reply(
          assetFilesDragFinishedChannel,
          assetFileDragResultSchema.parse({ requestId: request.requestId, status: 'ENDED' }),
        );
      }
    } catch {
      if (!event.sender.isDestroyed()) {
        event.reply(
          assetFilesDragFinishedChannel,
          assetFileDragResultSchema.parse({
            requestId: request.requestId,
            status: 'FAILED',
            message: 'Unable to prepare the image file for dragging',
          }),
        );
      }
    }
  });
  ipcMain.handle('asset-file:reveal-targets', (_event, rawId, rawContext) =>
    database.listAssetRevealTargets(id.parse(rawId), assetFileRevealTargetContextSchema.optional().parse(rawContext)),
  );
  ipcMain.handle('asset-file:reveal', (_event, rawId, rawContext) =>
    assetFiles.reveal(id.parse(rawId), assetFileRevealContextSchema.optional().parse(rawContext)),
  );
  ipcMain.handle('asset-file:open', (_event, rawId, rawContext) =>
    assetFiles.open(id.parse(rawId), assetFileRevealContextSchema.optional().parse(rawContext)),
  );
  ipcMain.handle('transition-showcase:export-images', (_event, rawAssetIds) => {
    const assetIds = transitionShowcaseExportImageIdsSchema.parse(rawAssetIds);
    const sources = assetIds.map((assetId) => {
      const source = database.resolveAssetFile(assetId);
      if (!source) throw new Error('Transition export image is unavailable');
      return source;
    });
    return createTransitionShowcaseExportImages(sources);
  });
  ipcMain.handle('asset:delete', (_event, rawId) => database.deleteAsset(id.parse(rawId)));
  ipcMain.handle('favorites:text-list', () => database.listFavoriteTexts());
  ipcMain.handle('favorites:add', (_event, rawTarget) =>
    database.addFavorite(materialAlbumTargetSchema.parse(rawTarget)),
  );
  ipcMain.handle('favorites:remove', (_event, rawMaterialId) => database.removeFavorite(id.parse(rawMaterialId)));
  ipcMain.handle('image-rating:set', (_event, rawAssetId, rawDimension, rawScore) => {
    const rating = database.setImageRating(
      id.parse(rawAssetId),
      imageRatingDimensionSchema.parse(rawDimension),
      imageRatingScoreSchema.parse(rawScore),
    );
    onTransitionPreviewSelectionChanged();
    return rating;
  });
}
