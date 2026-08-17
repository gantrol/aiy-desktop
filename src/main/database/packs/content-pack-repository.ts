import { loadContentPackPackage, type LoadedContentPackPackage } from '@/main/content-packs/package-loader';
import { reconcileDictionaryCore } from '@/main/dictionary/dictionary-core';
import { reconcileWordPaletteCatalog } from '@/main/dictionary/word-palettes';
import { assignFacetSystemRoles } from '@/main/database/dictionary/facet-system-roles';
import { reconcileFixture } from '@/main/database/packs/fixture-loader';
import { contentPackExamplesAreCurrent, reconcileContentPackExamples } from '@/main/content-packs/example-importer';
import type { FixturePackRepository } from '@/main/database/packs/fixture-pack-repository';
import type { LibraryStorage } from '@/main/database/core/storage';
import { trimSurroundingCharacters } from '@/shared/string-boundaries';

function revisionMarkerKey(packId: string, contentKind: 'dictionary' | 'palettes') {
  const identity = trimSurroundingCharacters(packId.toLowerCase().replace(/[^a-z0-9]+/g, '_'), '_');
  return `content_pack_${identity}_${contentKind}_revision`;
}

export class ContentPackRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly fixturePacks: FixturePackRepository,
  ) {}

  importPackage(packagePath: string) {
    return this.install(loadContentPackPackage(packagePath));
  }

  private install(contentPackage: LoadedContentPackPackage) {
    const source = this.fixturePacks.prepare(contentPackage.profile, contentPackage.sourcePaths);
    const sourceIsCurrent = this.fixturePacks.isCurrent(source);
    const examplesAreCurrent =
      !contentPackage.examplesDocument ||
      (contentPackage.exampleAssetsRoot
        ? contentPackExamplesAreCurrent(this.storage.db, source.profile.id, contentPackage.examplesDocument)
        : false);
    if (!sourceIsCurrent || !examplesAreCurrent) {
      const existingPack = this.storage.db.prepare('SELECT 1 FROM packs WHERE id = ?').get(contentPackage.profile.id);
      if (!sourceIsCurrent && contentPackage.manifest.seedLibrary && !existingPack && !this.isLibraryEmpty()) {
        throw new Error('This content pack can only seed an empty library');
      }
      this.storage.db.transaction(() => {
        if (!sourceIsCurrent) {
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
          } else {
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
          this.fixturePacks.ensure(source);
        }
        if (!examplesAreCurrent && contentPackage.examplesDocument && contentPackage.exampleAssetsRoot) {
          reconcileContentPackExamples(
            this.storage,
            source.profile.id,
            contentPackage.examplesDocument,
            contentPackage.exampleAssetsRoot,
          );
        }
      })();
    }
    if (!this.fixturePacks.isCurrent(source)) {
      throw new Error(`Content pack did not converge: ${source.profile.id}`);
    }
    if (contentPackage.examplesDocument && contentPackage.exampleAssetsRoot) {
      if (!contentPackExamplesAreCurrent(this.storage.db, source.profile.id, contentPackage.examplesDocument)) {
        throw new Error(`Content pack examples did not converge: ${source.profile.id}`);
      }
    }
    return source.profile.id;
  }

  private isLibraryEmpty() {
    return !Boolean(
      this.storage.db
        .prepare(
          `SELECT
            EXISTS(SELECT 1 FROM materials WHERE deleted_at IS NULL) OR
            EXISTS(SELECT 1 FROM creation_drafts WHERE deleted_at IS NULL) OR
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
