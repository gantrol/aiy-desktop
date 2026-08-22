import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  albumAddMembersSchema,
  albumCreateFromMaterialsSchema,
  albumCreateSchema,
  albumCreationDefaultsUpdateSchema,
  albumMoveSchema,
  albumMoveSeriesSchema,
  albumRemoveMembersSchema,
  albumRenameSchema,
  albumReorderMembersSchema,
  albumSetArchivedSchema,
  albumSetPinnedSchema,
  id,
  localeSchema,
  materialAlbumAddManySchema,
  materialAlbumCreateSchema,
  materialAlbumListSchema,
  materialAlbumMoveSchema,
  materialAlbumRemoveSchema,
  materialAlbumRenameSchema,
  materialMetadataUpdateSchema,
  sidebarRootReorderSchema,
} from '@/main/ipc/schemas';

export function registerLibraryIpc(ipcMain: IpcHandlerRegistrar, database: LibraryDatabase) {
  ipcMain.handle('material-albums:list', (_event, raw) =>
    database.listMaterialAlbums(materialAlbumListSchema.parse(raw)),
  );
  ipcMain.handle('material-albums:create', (_event, raw) =>
    database.createMaterialAlbum(materialAlbumCreateSchema.parse(raw)),
  );
  ipcMain.handle('material-albums:rename', (_event, raw) =>
    database.renameMaterialAlbum(materialAlbumRenameSchema.parse(raw)),
  );
  ipcMain.handle('material-albums:move', (_event, raw) =>
    database.moveMaterialAlbum(materialAlbumMoveSchema.parse(raw)),
  );
  ipcMain.handle('material-albums:delete', (_event, rawId) => database.deleteMaterialAlbum(id.parse(rawId)));
  ipcMain.handle('material-albums:add-many', (_event, raw) =>
    database.addMaterialAlbumMembers(materialAlbumAddManySchema.parse(raw)),
  );
  ipcMain.handle('material-albums:remove', (_event, raw) =>
    database.removeMaterialAlbumMembers(materialAlbumRemoveSchema.parse(raw)),
  );
  ipcMain.handle('albums:list', (_event, rawLocale) => database.listAlbums(localeSchema.parse(rawLocale)));
  ipcMain.handle('albums:list-text-materials', (_event, rawId) => database.listAlbumTextMaterials(id.parse(rawId)));
  ipcMain.handle('albums:create', (_event, raw) => database.createAlbum(albumCreateSchema.parse(raw)));
  ipcMain.handle('albums:create-from-materials', (_event, raw) =>
    database.createAlbumFromMaterials(albumCreateFromMaterialsSchema.parse(raw)),
  );
  ipcMain.handle('albums:rename', (_event, raw) => database.renameAlbum(albumRenameSchema.parse(raw)));
  ipcMain.handle('albums:update-creation-defaults', (_event, raw) =>
    database.updateAlbumCreationDefaults(albumCreationDefaultsUpdateSchema.parse(raw)),
  );
  ipcMain.handle('albums:delete', (_event, rawId) => database.deleteAlbum(id.parse(rawId)));
  ipcMain.handle('albums:set-pinned', (_event, raw) => database.setAlbumPinned(albumSetPinnedSchema.parse(raw)));
  ipcMain.handle('albums:archive', (_event, rawId) => database.archiveAlbum(id.parse(rawId)));
  ipcMain.handle('albums:set-archived', (_event, raw) => database.setAlbumArchived(albumSetArchivedSchema.parse(raw)));
  ipcMain.handle('albums:move', (_event, raw) => database.moveAlbum(albumMoveSchema.parse(raw)));
  ipcMain.handle('albums:move-series', (_event, raw) => database.moveAlbumSeries(albumMoveSeriesSchema.parse(raw)));
  ipcMain.handle('albums:add-members', (_event, raw) => database.addAlbumMembers(albumAddMembersSchema.parse(raw)));
  ipcMain.handle('albums:remove-members', (_event, raw) =>
    database.removeAlbumMembers(albumRemoveMembersSchema.parse(raw)),
  );
  ipcMain.handle('albums:reorder-members', (_event, raw) =>
    database.reorderAlbumMembers(albumReorderMembersSchema.parse(raw)),
  );
  ipcMain.handle('albums:reorder-root', (_event, raw) =>
    database.reorderSidebarRoot(sidebarRootReorderSchema.parse(raw)),
  );
  ipcMain.handle('material-metadata:update', (_event, raw) =>
    database.updateMaterialMetadata(materialMetadataUpdateSchema.parse(raw)),
  );
  ipcMain.handle('material-provenance:suggestions', () => database.materialProvenanceSuggestions());
}
