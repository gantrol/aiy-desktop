import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type {
  AddMaterialsToDestinationsInput,
  AlbumAddMembersInput,
  AlbumCreateFromMaterialsInput,
  AlbumCreateInput,
  AlbumCreationDefaultsUpdateInput,
  AlbumMoveInput,
  AlbumRemoveMembersInput,
  AlbumRenameInput,
  AlbumReorderMembersInput,
  AlbumSetArchivedInput,
  AlbumSetPinnedInput,
  AssetFileRevealContext,
  AssetFileRevealTargetContext,
  CreateMaterialCollectionFromSourceInput,
  ContentLifecycleApplyInput,
  ContentLifecycleListInput,
  ContentLifecyclePlanInput,
  ContentLifecyclePurgeInput,
  ContentLifecyclePurgePlanInput,
  ContentLifecycleRestoreInput,
  DictionaryMaintenanceCreateInput,
  DictionaryMaintenanceListInput,
  ExternalMaterialMetadataUpdateInput,
  GalleryListInput,
  HistoricalTermRecommendationCreateInput,
  HistoricalTermRecommendationListInput,
  ImageRatingDimension,
  KnowledgeDistillationAcceptInput,
  KnowledgeDistillationCreateInput,
  Locale,
  MaterialAlbumAddManyInput,
  MaterialAlbumCreateInput,
  MaterialAlbumListInput,
  MaterialAlbumMoveInput,
  MaterialAlbumRemoveInput,
  MaterialAlbumRenameInput,
  MaterialImageAssetsResolveInput,
  RecycleBinListInput,
  RecycleBinPurgeInput,
  RecycleBinPurgePlanInput,
  RecycleBinRestoreInput,
  RenameCreationAlbumInput,
  SidebarRootReorderInput,
} from '@/shared/contracts';

export function createAssetLibraryApi(
  repositories: Pick<
    LibraryDatabaseRepositories,
    | 'albums'
    | 'assetFiles'
    | 'assetLifecycle'
    | 'assetRelationships'
    | 'db'
    | 'contentLifecycle'
    | 'dictionaryMaintenance'
    | 'gallery'
    | 'historicalTermRecommendations'
    | 'knowledgeDistillations'
    | 'libraryFileView'
    | 'materialAlbums'
    | 'materialMemberships'
    | 'materialMetadata'
    | 'packs'
    | 'ratings'
    | 'recycleBin'
  >,
) {
  return {
    listImageRatings() {
      return repositories.ratings.list();
    },

    listGallery(input: GalleryListInput) {
      return repositories.gallery.list(input);
    },

    listTransitionPreviewSources(limit?: number) {
      return repositories.gallery.listTransitionPreviewSources(limit);
    },

    getAssetRelationship(assetId: string, locale: Locale = 'zh') {
      return repositories.assetRelationships.get(assetId, locale);
    },

    listKnowledgeDistillationProposals(sourceAssetId: string) {
      return repositories.knowledgeDistillations.list(sourceAssetId);
    },

    createKnowledgeDistillationProposal(input: KnowledgeDistillationCreateInput) {
      return repositories.knowledgeDistillations.create(input);
    },

    acceptKnowledgeDistillationProposal(input: KnowledgeDistillationAcceptInput) {
      return repositories.knowledgeDistillations.accept(input);
    },

    listHistoricalTermRecommendationRuns(input: HistoricalTermRecommendationListInput) {
      return repositories.historicalTermRecommendations.list(input);
    },

    createHistoricalTermRecommendationRun(input: HistoricalTermRecommendationCreateInput) {
      return repositories.historicalTermRecommendations.create(input);
    },

    listDictionaryMaintenanceReports(input: DictionaryMaintenanceListInput) {
      return repositories.dictionaryMaintenance.list(input.locale, input.limit);
    },

    createDictionaryMaintenanceReport(input: DictionaryMaintenanceCreateInput) {
      return repositories.dictionaryMaintenance.create(input.locale);
    },

    resolveAssetFile(assetId: string) {
      return repositories.assetFiles.resolve(assetId);
    },

    resolveAssetFilesAsync(assetIds: readonly string[]) {
      return repositories.assetFiles.resolveManyAsync(assetIds);
    },

    deleteAsset(assetId: string) {
      return repositories.assetLifecycle.delete(assetId);
    },

    listRecycleBin(input: RecycleBinListInput) {
      return repositories.recycleBin.list(input);
    },

    restoreRecycleBinEntry(input: RecycleBinRestoreInput) {
      return repositories.recycleBin.restore(input);
    },

    planRecycleBinPurge(input: RecycleBinPurgePlanInput) {
      return repositories.recycleBin.planPurge(input);
    },

    purgeRecycleBin(input: RecycleBinPurgeInput) {
      return repositories.recycleBin.purge(input);
    },

    listContentLifecycle(input: ContentLifecycleListInput) {
      return repositories.contentLifecycle.list(input);
    },

    planContentLifecycle(input: ContentLifecyclePlanInput) {
      return repositories.contentLifecycle.plan(input);
    },

    applyContentLifecycle(input: ContentLifecycleApplyInput) {
      return repositories.contentLifecycle.apply(input);
    },

    restoreContentLifecycle(input: ContentLifecycleRestoreInput) {
      return repositories.contentLifecycle.restore(input);
    },

    planContentLifecyclePurge(input: ContentLifecyclePurgePlanInput) {
      return repositories.contentLifecycle.planPurge(input);
    },

    purgeContentLifecycle(input: ContentLifecyclePurgeInput) {
      return repositories.contentLifecycle.purge(input);
    },

    resolveAssetRevealPath(assetId: string, context?: AssetFileRevealContext) {
      const asset = repositories.assetFiles.resolve(assetId);
      return asset ? repositories.libraryFileView.resolveRevealPath(asset, context) : null;
    },

    async resolveAssetRevealPathAsync(assetId: string, context?: AssetFileRevealContext) {
      const asset = (await repositories.assetFiles.resolveManyAsync([assetId])).get(assetId);
      return asset ? repositories.libraryFileView.resolveRevealPathAsync(asset, context) : null;
    },

    async listAssetRevealTargets(assetId: string, context?: AssetFileRevealTargetContext) {
      const asset = (await repositories.assetFiles.resolveManyAsync([assetId])).get(assetId);
      return asset ? repositories.libraryFileView.listRevealTargetsAsync(asset, context) : [];
    },

    createMaterialCollectionFromSource(input: CreateMaterialCollectionFromSourceInput) {
      let imageAssetIds: string[];
      if (input.snapshot.kind === 'GALLERY_QUERY') {
        if (input.source.kind !== 'MATERIAL_VIEW') {
          throw new Error('Gallery query snapshots require a material view source');
        }
        if (input.snapshot.query.albumId !== input.source.viewId) {
          throw new Error('Gallery query does not match the material view source');
        }
        imageAssetIds = [];
        let cursor: string | null = null;
        do {
          const page = repositories.gallery.list({
            ...input.snapshot.query,
            locale: input.locale,
            cursor,
            limit: 60,
          });
          imageAssetIds.push(...page.items.map((item) => item.asset.id));
          if (imageAssetIds.length > 100_000) throw new Error('Material collection snapshot is too large');
          cursor = page.nextCursor;
        } while (cursor);
      } else {
        if (input.source.kind === 'MATERIAL_VIEW') {
          throw new Error('Material views require a gallery query snapshot');
        }
        imageAssetIds = [...new Set(input.snapshot.imageAssetIds)];
      }
      // Gallery pagination is intentionally outside the write transaction. Holding a
      // deferred read transaction while the projection worker commits can otherwise
      // fail the later read-to-write upgrade with SQLITE_BUSY.
      return repositories.materialAlbums.createCollectionFromSource(input, imageAssetIds);
    },

    renameCreationAlbum(input: RenameCreationAlbumInput) {
      return repositories.materialAlbums.renameCreationAlbum(input);
    },

    listMaterialAlbums(input: MaterialAlbumListInput = { locale: 'zh' }) {
      return repositories.materialAlbums.list(input);
    },

    createMaterialAlbum(input: MaterialAlbumCreateInput) {
      return repositories.materialAlbums.create(input);
    },

    renameMaterialAlbum(input: MaterialAlbumRenameInput) {
      return repositories.materialAlbums.rename(input);
    },

    moveMaterialAlbum(input: MaterialAlbumMoveInput) {
      return repositories.materialAlbums.move(input);
    },

    deleteMaterialAlbum(albumId: string) {
      return repositories.materialAlbums.delete(albumId);
    },

    addMaterialAlbumMembers(input: MaterialAlbumAddManyInput) {
      return repositories.materialAlbums.addMany(input);
    },

    removeMaterialAlbumMembers(input: MaterialAlbumRemoveInput) {
      return repositories.materialAlbums.remove(input);
    },

    listAlbums(locale: Locale = 'zh') {
      return repositories.albums.list(locale);
    },

    listAlbumTextMaterials(albumId: string) {
      return repositories.albums.listTextMaterials(albumId);
    },

    createAlbum(input: AlbumCreateInput) {
      return repositories.albums.create(input);
    },

    renameAlbum(input: AlbumRenameInput) {
      return repositories.albums.rename(input);
    },

    updateAlbumCreationDefaults(input: AlbumCreationDefaultsUpdateInput) {
      return repositories.db.transaction(() => {
        const sources =
          input.defaults.dictionaryScope.mode === 'SELECTED' ? input.defaults.dictionaryScope.sources : [];
        const installations = repositories.packs.listPackInstallations();
        for (const source of sources) {
          if (
            !installations.some(
              (installation) =>
                installation.packId === source.packId &&
                installation.selectedReleaseId === source.packReleaseId &&
                installation.state === 'INSTALLED' &&
                installation.deletedAt === null,
            )
          ) {
            throw new Error('A selected album dictionary source is unavailable');
          }
        }
        repositories.packs.syncAlbumDictionarySources(input.albumId, sources);
        return repositories.albums.updateCreationDefaults(input);
      })();
    },

    deleteAlbum(albumId: string) {
      return repositories.albums.delete(albumId);
    },

    setAlbumPinned(input: AlbumSetPinnedInput) {
      return repositories.albums.setPinned(input);
    },

    archiveAlbum(albumId: string) {
      return repositories.albums.archive(albumId);
    },

    setAlbumArchived(input: AlbumSetArchivedInput) {
      return repositories.albums.setArchived(input);
    },

    moveAlbum(input: AlbumMoveInput) {
      return repositories.albums.move(input);
    },

    addAlbumMembers(input: AlbumAddMembersInput) {
      return repositories.albums.addMembers(input);
    },

    removeAlbumMembers(input: AlbumRemoveMembersInput) {
      return repositories.albums.removeMembers(input);
    },

    reorderAlbumMembers(input: AlbumReorderMembersInput) {
      return repositories.albums.reorderMembers(input);
    },

    reorderSidebarRoot(input: SidebarRootReorderInput) {
      return repositories.albums.reorderRoot(input);
    },

    ensureImageMaterial(imageAssetId: string) {
      return repositories.albums.ensureImageMaterial(imageAssetId);
    },

    addMaterialsToDestinations(input: AddMaterialsToDestinationsInput) {
      return repositories.materialMemberships.addToDestinations(input);
    },

    resolveMaterialImageAssets(input: MaterialImageAssetsResolveInput) {
      return repositories.materialMemberships.resolveImageAssets(input.targets);
    },

    createAlbumFromMaterials(input: AlbumCreateFromMaterialsInput) {
      return repositories.materialMemberships.createAlbumFromMaterials(input);
    },

    updateMaterialMetadata(input: ExternalMaterialMetadataUpdateInput) {
      return repositories.materialMetadata.update(input);
    },

    materialProvenanceSuggestions() {
      return repositories.materialMetadata.suggestions();
    },

    setImageRating(imageAssetId: string, dimension: ImageRatingDimension, score: number | null) {
      return repositories.ratings.set(imageAssetId, dimension, score);
    },
  };
}

export type AssetLibraryApi = ReturnType<typeof createAssetLibraryApi>;
