import type { LibraryDatabase } from '@/main/database';
import { albumOpenInputSchema } from '@/shared/contracts/app-deep-link';
import { creationOutlineCommandSchema } from '@/shared/contracts/creation-outline';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  creationFormAddOrGetInputSchema,
  creationItemCreateWithFormInputSchema,
  creationItemGetInputSchema,
  creationItemListInputSchema,
  creationItemMoveInputSchema,
  creationItemSetPinnedInputSchema,
  creationItemSetPrimaryInputSchema,
} from '@/shared/contracts/creation-library';
import {
  evaluationSuiteCreateInputSchema,
  evaluationSuiteGetInputSchema,
  evaluationSuiteSaveInputSchema,
} from '@/shared/contracts/evaluation-suite';
import {
  albumAddMembersSchema,
  albumCreateFromMaterialsSchema,
  albumCreateSchema,
  albumCreationDefaultsUpdateSchema,
  albumMoveSchema,
  albumRemoveMembersSchema,
  albumRenameSchema,
  albumReorderMembersSchema,
  albumSetArchivedSchema,
  albumSetPinnedSchema,
  contentLifecycleApplySchema,
  contentLifecycleListSchema,
  contentLifecyclePlanSchema,
  contentLifecyclePurgePlanSchema,
  contentLifecyclePurgeSchema,
  contentLifecycleRestoreSchema,
  id,
  localeSchema,
  materialAlbumAddManySchema,
  materialAlbumCreateSchema,
  materialAlbumListSchema,
  materialAlbumMoveSchema,
  materialAlbumRemoveSchema,
  materialAlbumRenameSchema,
  materialImageAssetsResolveSchema,
  materialMetadataUpdateSchema,
  recycleBinListSchema,
  recycleBinPurgePlanSchema,
  recycleBinPurgeSchema,
  recycleBinRestoreSchema,
  sidebarRootReorderSchema,
} from '@/main/ipc/schemas';

export function registerLibraryIpc(ipcMain: IpcHandlerRegistrar, database: LibraryDatabase) {
  ipcMain.handle('creation-outline:command', (_event, raw) =>
    database.creationOutlineCommand(creationOutlineCommandSchema.parse(raw)),
  );
  ipcMain.handle('creation-items:list', (_event, raw) =>
    database.listCreationItems(creationItemListInputSchema.parse(raw ?? {})),
  );
  ipcMain.handle('creation-item:get', (_event, raw) => database.getCreationItem(creationItemGetInputSchema.parse(raw)));
  ipcMain.handle('creation-item:create-with-form', (_event, raw) =>
    database.createCreationItemWithForm(creationItemCreateWithFormInputSchema.parse(raw)),
  );
  ipcMain.handle('creation-form:add-or-get', (_event, raw) =>
    database.addOrGetCreationForm(creationFormAddOrGetInputSchema.parse(raw)),
  );
  ipcMain.handle('creation-item:move', (_event, raw) =>
    database.moveCreationItem(creationItemMoveInputSchema.parse(raw)),
  );
  ipcMain.handle('creation-item:set-pinned', (_event, raw) =>
    database.setCreationItemPinned(creationItemSetPinnedInputSchema.parse(raw)),
  );
  ipcMain.handle('creation-item:set-primary', (_event, raw) =>
    database.setCreationItemPrimaryForm(creationItemSetPrimaryInputSchema.parse(raw)),
  );
  ipcMain.handle('evaluation-suites:list', () => database.listEvaluationSuites());
  ipcMain.handle('evaluation-suite:get', (_event, raw) => {
    const input = evaluationSuiteGetInputSchema.parse(raw);
    return database.getEvaluationSuite(input.id);
  });
  ipcMain.handle('evaluation-suite:create', (_event, raw) =>
    database.createEvaluationSuite(evaluationSuiteCreateInputSchema.parse(raw)),
  );
  ipcMain.handle('evaluation-suite:save', (_event, raw) =>
    database.saveEvaluationSuite(evaluationSuiteSaveInputSchema.parse(raw)),
  );
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
  ipcMain.handle('material-image-assets:resolve', (_event, raw) =>
    database.resolveMaterialImageAssets(materialImageAssetsResolveSchema.parse(raw)),
  );
  ipcMain.handle('albums:list', (_event, rawLocale) => database.listAlbums(localeSchema.parse(rawLocale)));
  ipcMain.handle('album:open', (_event, raw) => {
    const input = albumOpenInputSchema.parse(raw);
    if (database.getLocalSpace().id !== input.spaceId) throw new Error('SPACE_CONFLICT');
    return { spaceId: input.spaceId, album: database.getActiveAlbum(input.albumId) };
  });
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
  ipcMain.handle('recycle-bin:list', (_event, raw) => database.listRecycleBin(recycleBinListSchema.parse(raw)));
  ipcMain.handle('recycle-bin:restore', (_event, raw) =>
    database.restoreRecycleBinEntry(recycleBinRestoreSchema.parse(raw)),
  );
  ipcMain.handle('recycle-bin:plan-purge', (_event, raw) =>
    database.planRecycleBinPurge(recycleBinPurgePlanSchema.parse(raw)),
  );
  ipcMain.handle('recycle-bin:purge', (_event, raw) => database.purgeRecycleBin(recycleBinPurgeSchema.parse(raw)));
  ipcMain.handle('content-lifecycle:list', (_event, raw) =>
    database.listContentLifecycle(contentLifecycleListSchema.parse(raw)),
  );
  ipcMain.handle('content-lifecycle:plan', (_event, raw) =>
    database.planContentLifecycle(contentLifecyclePlanSchema.parse(raw)),
  );
  ipcMain.handle('content-lifecycle:apply', (_event, raw) =>
    database.applyContentLifecycle(contentLifecycleApplySchema.parse(raw)),
  );
  ipcMain.handle('content-lifecycle:restore', (_event, raw) =>
    database.restoreContentLifecycle(contentLifecycleRestoreSchema.parse(raw)),
  );
  ipcMain.handle('content-lifecycle:plan-purge', (_event, raw) =>
    database.planContentLifecyclePurge(contentLifecyclePurgePlanSchema.parse(raw)),
  );
  ipcMain.handle('content-lifecycle:purge', (_event, raw) =>
    database.purgeContentLifecycle(contentLifecyclePurgeSchema.parse(raw)),
  );
  ipcMain.handle('material-metadata:update', (_event, raw) =>
    database.updateMaterialMetadata(materialMetadataUpdateSchema.parse(raw)),
  );
  ipcMain.handle('material-provenance:suggestions', () => database.materialProvenanceSuggestions());
}
