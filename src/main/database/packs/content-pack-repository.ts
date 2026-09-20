import { loadContentPackPackage, type LoadedContentPackPackage } from '@/main/content-packs/package-loader';
import { commitContentPackExampleAssets, stageContentPackExampleAssets } from '@/main/content-packs/example-importer';
import { planContentPackUpdate } from '@/main/content-packs/update-planner';
import { reconcileDictionaryCore } from '@/main/dictionary/dictionary-core';
import { reconcileWordPaletteCatalog } from '@/main/dictionary/word-palettes';
import { assignFacetSystemRoles } from '@/main/database/dictionary/facet-system-roles';
import { reconcileFixture } from '@/main/database/packs/fixture-loader';
import type { FixturePackRepository } from '@/main/database/packs/fixture-pack-repository';
import type { LibraryStorage } from '@/main/database/core/storage';
import { trimSurroundingCharacters } from '@/shared/string-boundaries';
import { prepareContentPackCreations, type PreparedContentPackCreations } from '@/main/content-packs/creation-source';
import { stageContentPackCreations } from '@/main/content-packs/creation-importer';
import { contentPackCreationStates } from '@/main/content-packs/creation-state';
import type { AlbumRepository } from '@/main/database/albums/album-repository';
import type { ArticleRepository } from '@/main/database/creations/article-repository';
import type { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import { PackSyncRepository } from '@/main/database/packs/pack-sync-repository';
import type { PackSyncSummary } from '@/shared/pack-sync';

function revisionMarkerKey(packId: string, contentKind: 'dictionary' | 'palettes') {
  const identity = trimSurroundingCharacters(packId.toLowerCase().replace(/[^a-z0-9]+/g, '_'), '_');
  return `content_pack_${identity}_${contentKind}_revision`;
}

export class ContentPackRepository {
  private readonly syncs: PackSyncRepository;
  constructor(
    private readonly storage: LibraryStorage,
    private readonly fixturePacks: FixturePackRepository,
    private readonly albums: AlbumRepository,
    private readonly articles: ArticleRepository,
    private readonly creationItems: CreationItemRepository,
  ) {
    this.syncs = new PackSyncRepository(storage);
  }

  importPackage(packagePath: string) {
    return this.syncs.runAsync('CONTENT_PACK', (syncRunId) => this.loadAndInstall(packagePath, syncRunId));
  }

  importPackages(packagePaths: readonly string[], kind: PackSyncSummary['kind']) {
    if (!packagePaths.length || packagePaths.length > 100) throw new Error('Pack sync requires 1 to 100 packages');
    return this.syncs.runAsync(kind, async (syncRunId) => {
      const packIds: string[] = [];
      for (const packagePath of packagePaths) packIds.push(await this.loadAndInstall(packagePath, syncRunId));
      return packIds;
    });
  }

  async previewPackage(packagePath: string) {
    const contentPackage = await this.loadPackage(packagePath);
    const source = this.fixturePacks.prepare(contentPackage.profile, contentPackage.sourcePaths);
    return { ...planContentPackUpdate(this.storage.db, source), packageFingerprint: contentPackage.packageFingerprint };
  }

  importPreviewedPackage(
    packagePath: string,
    expectedContentHash: string,
    expectedPackageFingerprint: string,
    signal?: AbortSignal,
  ) {
    return this.syncs.runAsync('CONTENT_PACK', (syncRunId) =>
      this.loadAndInstall(packagePath, syncRunId, expectedContentHash, expectedPackageFingerprint, signal),
    );
  }

  private async loadAndInstall(
    packagePath: string,
    syncRunId: string,
    expectedContentHash?: string,
    expectedPackageFingerprint?: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const contentPackage = await this.loadPackage(packagePath);
    const source = this.fixturePacks.prepare(contentPackage.profile, contentPackage.sourcePaths);
    const contentHash = `sha256:${source.sourceDigest}`;
    try {
      if (
        (expectedContentHash && expectedContentHash !== contentHash) ||
        (expectedPackageFingerprint && expectedPackageFingerprint !== contentPackage.packageFingerprint)
      ) {
        throw new Error('Content pack changed after its update preview');
      }
      return await this.install(contentPackage, source, syncRunId, signal);
    } catch (error) {
      this.syncs.recordItem(syncRunId, {
        packId: source.profile.id,
        title: source.profile.displayName.slice(0, 300),
        version: source.releaseVersion,
        status: 'FAILED',
      });
      throw error;
    }
  }

  private async loadPackage(packagePath: string) {
    const contentPackage = await loadContentPackPackage(packagePath);
    const spaceId = String(
      this.storage.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get(),
    );
    const preparedCreations = contentPackage.creationsDocument
      ? prepareContentPackCreations(contentPackage.profile.id, contentPackage.creationsDocument, spaceId)
      : undefined;
    if (preparedCreations)
      contentPackage.sourcePaths.supplementalItems = [
        ...(contentPackage.sourcePaths.supplementalItems ?? []),
        ...preparedCreations.items,
      ];
    return { ...contentPackage, preparedCreations };
  }

  private assertCreationUpdate(source: ReturnType<FixturePackRepository['prepare']>) {
    const states = contentPackCreationStates(this.storage.db, source.profile.id, source.supplementalItems);
    const removedLayout =
      !source.supplementalItems.some((item) => item.objectType === 'CREATION_COLLECTION') &&
      this.storage.db
        .prepare(
          `SELECT 1 FROM pack_release_items item
      JOIN pack_releases release ON release.id = item.release_id
      WHERE release.pack_id = ? AND item.object_type = 'CREATION_COLLECTION' LIMIT 1`,
        )
        .get(source.profile.id);
    if (removedLayout || [...states.values()].includes('CONFLICT'))
      throw Object.assign(
        new Error('Content pack creation structure or local identities conflict; resolve them before importing'),
        { code: 'CONTENT_PACK_CREATION_CONFLICT' },
      );
  }

  private async install(
    contentPackage: LoadedContentPackPackage & { preparedCreations?: PreparedContentPackCreations },
    source: ReturnType<FixturePackRepository['prepare']>,
    syncRunId: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    this.assertCreationUpdate(source);
    const sourceIsCurrent = this.fixturePacks.isCurrent(source);
    if (sourceIsCurrent) return source.profile.id;
    const syncItem = {
      packId: source.profile.id,
      title: source.profile.displayName.slice(0, 300),
      version: source.releaseVersion,
    };
    this.syncs.recordItem(syncRunId, { ...syncItem, status: 'RUNNING' });
    const existingPack = this.storage.db.prepare('SELECT 1 FROM packs WHERE id = ?').get(contentPackage.profile.id);
    if (contentPackage.manifest.seedLibrary && !existingPack && !this.isLibraryEmpty()) {
      throw new Error('This content pack can only seed an empty library');
    }
    const stagedExamples = await stageContentPackExampleAssets(this.storage, contentPackage.preparedExamples);
    signal?.throwIfAborted();
    this.storage.db
      .transaction(() => {
        this.assertCreationUpdate(source);
        if (contentPackage.manifest.seedLibrary) {
          reconcileFixture(this.storage, contentPackage.fixturePath, {
            assetsRoot: contentPackage.assetsRoot,
            dictionaryPath: contentPackage.dictionaryPath,
            palettePath: contentPackage.palettePath,
            fixtureDocument: source.documents.fixture,
            dictionarySource: {
              document: source.documents.dictionary,
              catalogRows: source.documents.dictionaryCatalogRows,
              includeInlineTerms: source.profile.includeInlineTerms,
            },
            paletteDocument: source.documents.palette,
          });
        } else if (contentPackage.manifest.source.dictionary) {
          reconcileDictionaryCore(
            this.storage.db,
            contentPackage.dictionaryPath,
            revisionMarkerKey(source.profile.id, 'dictionary'),
            {
              document: source.documents.dictionary,
              catalogRows: source.documents.dictionaryCatalogRows,
              includeInlineTerms: source.profile.includeInlineTerms,
            },
          );
          if (contentPackage.palettePath) {
            reconcileWordPaletteCatalog(
              this.storage.db,
              contentPackage.palettePath,
              revisionMarkerKey(source.profile.id, 'palettes'),
              source.documents.palette,
            );
          }
        }
        assignFacetSystemRoles(this.storage.db, contentPackage.facetRoles);
        commitContentPackExampleAssets(this.storage, stagedExamples);
        if (contentPackage.preparedCreations) {
          const staged = stageContentPackCreations(
            this.storage,
            contentPackage.preparedCreations,
            this.albums,
            this.articles,
            this.creationItems,
          );
          const mappings = new Map(staged.map((item) => [item.itemKey, item]));
          source.supplementalItems = source.supplementalItems.map((item) => mappings.get(item.itemKey) ?? item);
        }
        this.fixturePacks.ensure(source, syncRunId);
        if (!this.fixturePacks.isCurrent(source))
          throw new Error(`Content pack did not converge: ${source.profile.id}`);
        this.syncs.recordItem(syncRunId, { ...syncItem, status: 'SUCCEEDED' });
      })
      .immediate();
    return source.profile.id;
  }

  private isLibraryEmpty() {
    return !Boolean(
      this.storage.db
        .prepare(
          `SELECT
            EXISTS(SELECT 1 FROM materials WHERE deleted_at IS NULL) OR
            EXISTS(SELECT 1 FROM creation_drafts WHERE deleted_at IS NULL) OR
            EXISTS(SELECT 1 FROM evaluation_suites WHERE status = 'ACTIVE' AND deleted_at IS NULL) OR
            EXISTS(SELECT 1 FROM prompt_series WHERE deleted_at IS NULL) OR
            EXISTS(SELECT 1 FROM albums WHERE deleted_at IS NULL) OR
            EXISTS(SELECT 1 FROM terms) OR
            EXISTS(SELECT 1 FROM word_palettes WHERE deleted_at IS NULL) AS has_content`,
        )
        .pluck()
        .get(),
    );
  }
}
