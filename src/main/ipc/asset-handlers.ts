import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type { AssetFileActions } from '@/main/media/asset-file-actions';
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
) {
  ipcMain.handle('gallery:list', (_event, raw) => database.listGallery(galleryListSchema.parse(raw)));
  ipcMain.handle('asset-relationship:get', (_event, rawId, rawLocale) =>
    database.getAssetRelationship(id.parse(rawId), localeSchema.parse(rawLocale)),
  );
  ipcMain.handle('asset-file:availability', (_event, rawId) => assetFiles.availability(id.parse(rawId)));
  ipcMain.handle('asset-file:copy', (_event, rawId) => assetFiles.copy(id.parse(rawId)));
  ipcMain.handle('asset-file:save-as', (_event, rawId) => assetFiles.saveAs(id.parse(rawId)));
  ipcMain.handle('asset-file:reveal-targets', (_event, rawId, rawContext) =>
    database.listAssetRevealTargets(id.parse(rawId), assetFileRevealTargetContextSchema.optional().parse(rawContext)),
  );
  ipcMain.handle('asset-file:reveal', (_event, rawId, rawContext) =>
    assetFiles.reveal(id.parse(rawId), assetFileRevealContextSchema.optional().parse(rawContext)),
  );
  ipcMain.handle('asset-file:open', (_event, rawId) => assetFiles.open(id.parse(rawId)));
  ipcMain.handle('asset:delete', (_event, rawId) => database.deleteAsset(id.parse(rawId)));
  ipcMain.handle('favorites:text-list', () => database.listFavoriteTexts());
  ipcMain.handle('favorites:add', (_event, rawTarget) =>
    database.addFavorite(materialAlbumTargetSchema.parse(rawTarget)),
  );
  ipcMain.handle('favorites:remove', (_event, rawMaterialId) => database.removeFavorite(id.parse(rawMaterialId)));
  ipcMain.handle('image-rating:set', (_event, rawAssetId, rawDimension, rawScore) =>
    database.setImageRating(
      id.parse(rawAssetId),
      imageRatingDimensionSchema.parse(rawDimension),
      imageRatingScoreSchema.parse(rawScore),
    ),
  );
}
