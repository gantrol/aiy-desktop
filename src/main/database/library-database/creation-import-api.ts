import type {
  CodexImageDiscoveryScanSnapshot,
  CodexImageScanEntry,
} from '@/main/database/extensions/codex-image-discovery-repository';
import type { StoredCreatorImage } from '@/main/database/creations/creation-import-repository';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { LibraryStorage } from '@/main/database/core/storage';
import type {
  CodexImageDiscoveryFilter,
  CodexTaskReferenceDto,
  CreatorImageImportContext,
  CreatorImageImportInput,
  ImportedCreationOutputUpdateInput,
  MaterialSelectionTargetInput,
  NewExternalCreationImportInput,
} from '@/shared/contracts';

export function createCreationImportApi(
  repositories: Pick<LibraryDatabaseRepositories, 'codexImageDiscoveries' | 'creationImports' | 'intake' | 'storage'>,
) {
  return {
    importCreatorReferences(input: CreatorImageImportInput) {
      return repositories.creationImports.importReferences(input);
    },

    importStoredCreatorReferences(source: CreatorImageImportContext['source'], images: StoredCreatorImage[]) {
      return repositories.creationImports.importStoredReferences(source, images);
    },

    importCreatorOutputs(input: CreatorImageImportInput) {
      return repositories.creationImports.importOutputs(input);
    },

    async storeVerifiedCreatorImportFile(
      sourcePath: string,
      extension: string,
      metadata: Parameters<LibraryStorage['storeVerifiedFile']>[2],
    ) {
      return repositories.storage.storeVerifiedFile(sourcePath, extension, metadata);
    },

    importStoredCreatorOutputs(context: CreatorImageImportContext, images: StoredCreatorImage[]) {
      return repositories.creationImports.importStoredOutputs(context, images);
    },

    importNewExternalCreation(input: NewExternalCreationImportInput) {
      return repositories.creationImports.importNewExternalCreation(input);
    },

    importStoredNewExternalCreation(
      input: NewExternalCreationImportInput,
      images: StoredCreatorImage[],
      duplicateCount = 0,
    ) {
      return repositories.creationImports.importStoredNewExternalCreation(input, images, duplicateCount);
    },

    importStoredCodexDiscoveredImages(
      input: NewExternalCreationImportInput,
      images: StoredCreatorImage[],
      bindings: readonly { discoveryId: string; contentHash: string }[],
      codexTask: CodexTaskReferenceDto,
    ) {
      return repositories.codexImageDiscoveries.importStoredImages(input, images, bindings, codexTask);
    },

    reconcileCodexImageDiscoveries(
      scanId: string,
      entries: readonly CodexImageScanEntry[],
      complete = true,
      scanSnapshot?: CodexImageDiscoveryScanSnapshot,
    ) {
      return repositories.codexImageDiscoveries.reconcileScan(scanId, entries, complete, scanSnapshot);
    },

    getCodexImageDiscoveryScanSnapshot() {
      return repositories.codexImageDiscoveries.scanSnapshot();
    },

    getCodexImageDiscoveryHashCache() {
      return repositories.codexImageDiscoveries.hashCache();
    },

    listCodexImageDiscoveries(
      page?: number,
      pageSize?: number,
      filter?: CodexImageDiscoveryFilter,
      includeUntitled?: boolean,
    ) {
      return repositories.codexImageDiscoveries.list(page, pageSize, filter, includeUntitled);
    },

    getCodexImageDiscoveries(discoveryIds: readonly string[]) {
      return repositories.codexImageDiscoveries.get(discoveryIds);
    },

    updateImportedCreationOutput(input: ImportedCreationOutputUpdateInput) {
      return repositories.creationImports.updateOutput(input);
    },

    listFavoriteTexts() {
      return repositories.intake.listFavoriteTexts();
    },

    addFavorite(target: MaterialSelectionTargetInput) {
      return repositories.intake.addFavorite(target);
    },

    removeFavorite(materialId: string) {
      return repositories.intake.removeFavorite(materialId);
    },
  };
}

export type CreationImportApi = ReturnType<typeof createCreationImportApi>;
