import { describe, expect, it } from 'vitest';
import { createTestLibrary } from './support/test-library';

function seedTerm(
  database: ReturnType<typeof createTestLibrary>['database'],
  id: string,
  revisionId: string,
  name: string,
) {
  const createdAt = '2026-07-30T00:00:00.000Z';
  database.db
    .prepare(
      `INSERT INTO terms
    (id, stable_key, current_revision_id, editorial_state, archived_at)
    VALUES (?, ?, NULL, 'APPROVED', NULL)`,
    )
    .run(id, `test.${id}`);
  database.db
    .prepare(
      `INSERT INTO term_revisions
    (id, term_id, revision_no, title, title_locale, definition, created_at)
    VALUES (?, ?, 1, ?, 'zh', '', ?)`,
    )
    .run(revisionId, id, name, createdAt);
  database.db
    .prepare(
      `INSERT INTO term_localizations
      (id, term_revision_id, locale, title, definition) VALUES (?, ?, 'en', ?, '')`,
    )
    .run(`${revisionId}:en`, revisionId, name);
  database.db.prepare('UPDATE terms SET current_revision_id = ? WHERE id = ?').run(revisionId, id);
}

function seedRecipe(database: ReturnType<typeof createTestLibrary>['database'], nestedTermId: string) {
  const createdAt = '2026-07-30T00:00:00.000Z';
  database.db
    .prepare(
      `INSERT INTO word_palettes
    (id, pinned, created_at, updated_at, archived_at, deleted_at, current_revision_id)
    VALUES ('recipe-main', 0, ?, ?, NULL, NULL, NULL)`,
    )
    .run(createdAt, createdAt);
  database.db
    .prepare(
      `INSERT INTO word_palette_revisions
    (id, palette_id, parent_revision_id, revision_no, name, name_locale,
     description, kind, content_hash, created_at)
    VALUES ('recipe-main:v1', 'recipe-main', NULL, 1, '主角配方', 'zh',
      '', 'STATIC', 'sha256:recipe-main-v1', ?)`,
    )
    .run(createdAt);
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_localizations
      (id, palette_revision_id, locale, name, description)
      VALUES ('recipe-main:v1:en', 'recipe-main:v1', 'en', 'Hero recipe', '')`,
    )
    .run();
  database.db.prepare("UPDATE word_palettes SET current_revision_id = 'recipe-main:v1' WHERE id = 'recipe-main'").run();
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_terms
    (id, palette_revision_id, term_id, sort_order)
    VALUES ('recipe-main:v1:term', 'recipe-main:v1', ?, 0)`,
    )
    .run(nestedTermId);
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_content_nodes
      (id, palette_revision_id, kind, term_id, parameter_revision_id, prompt_fragment, negative_fragment, sort_order)
      VALUES ('recipe-main:v1:node', 'recipe-main:v1', 'TERM', ?, NULL, '', '', 0)`,
    )
    .run(nestedTermId);
}

function seedPackSource(
  database: ReturnType<typeof createTestLibrary>['database'],
  key: string,
  objectType: string,
  objectRevisionId: string,
  localObjectType: string,
  localObjectId: string,
  localRevisionId: string,
) {
  const packId = `pack-${key}`;
  const releaseId = `${packId}:0.1.0`;
  const itemId = `${releaseId}:item`;
  database.registerPack({
    id: packId,
    kind: 'CONTENT',
    displayName: `${key} pack`,
    contentKinds: [objectType],
  });
  database.registerPackRelease({
    id: releaseId,
    packId,
    version: '0.1.0',
    manifestVersion: 1,
    contentHash: `sha256:${key}`,
    manifest: { key },
    items: [
      {
        id: itemId,
        itemKey: `item.${key}`,
        objectType,
        objectRevisionId,
        contentHash: `sha256:${key}:item`,
      },
    ],
  });
  database.linkPackReleaseItem({
    releaseItemId: itemId,
    localObjectType,
    localObjectId,
    localRevisionId,
    mappingKind: 'REUSED_IDENTICAL',
  });
  return { packId, releaseId, itemId };
}

describe('asset relationship detail', () => {
  it('returns every exact reverse relation and keeps recipe uses aggregate', () => {
    const library = createTestLibrary('aibd-asset-relationships-');
    try {
      const asset = library.importReference('relationship.png', 17);
      const inputAsset = library.importReference('input-reference.png', 18);
      const assetHash = (
        library.database.db.prepare('SELECT object_hash FROM image_assets WHERE id = ?').get(asset.id) as {
          object_hash: string;
        }
      ).object_hash;
      const inputAssetHash = (
        library.database.db.prepare('SELECT object_hash FROM image_assets WHERE id = ?').get(inputAsset.id) as {
          object_hash: string;
        }
      ).object_hash;
      seedTerm(library.database, 'term-direct', 'term-direct:v1', '直接词条');
      seedTerm(library.database, 'term-nested', 'term-nested:v1', '配方内词条');
      seedRecipe(library.database, 'term-nested');
      library.database.db
        .prepare(
          `INSERT INTO word_palette_revision_media
        (id, palette_revision_id, image_asset_id, sort_order)
        VALUES ('recipe-main:v1:reference', 'recipe-main:v1', ?, 0)`,
        )
        .run(inputAsset.id);

      const directTermPack = seedPackSource(
        library.database,
        'direct-term',
        'TERM_REVISION',
        'term-direct:v1',
        'TERM',
        'term-direct',
        'term-direct:v1',
      );
      const nestedTermPack = seedPackSource(
        library.database,
        'nested-term',
        'TERM_REVISION',
        'term-nested:v1',
        'TERM',
        'term-nested',
        'term-nested:v1',
      );
      const recipePack = seedPackSource(
        library.database,
        'recipe',
        'RECIPE_REVISION',
        'recipe-main:v1',
        'RECIPE',
        'recipe-main',
        'recipe-main:v1',
      );
      const directAssetPack = seedPackSource(
        library.database,
        'asset',
        'IMAGE_ASSET',
        assetHash,
        'IMAGE_ASSET',
        asset.id,
        assetHash,
      );
      const inputAssetPack = seedPackSource(
        library.database,
        'input-asset',
        'IMAGE_ASSET',
        inputAssetHash,
        'IMAGE_ASSET',
        inputAsset.id,
        inputAssetHash,
      );
      library.database.db
        .prepare(
          `INSERT INTO materials
        (id, kind, image_asset_id, text_content, content_hash, source_type, created_at, deleted_at)
        VALUES ('material-for-asset', 'IMAGE', ?, NULL, ?, 'TEST', ?, NULL)`,
        )
        .run(asset.id, assetHash, '2026-07-30T00:01:00.000Z');
      const directMaterialPack = seedPackSource(
        library.database,
        'material',
        'MATERIAL_REVISION',
        'material-for-asset:v1',
        'MATERIAL',
        'material-for-asset',
        'material-for-asset:v1',
      );

      const generation = library.database.prepareGeneration({
        seriesId: null,
        title: '关系测试',
        manualPrompt: '保留原始指令',
        prompt: 'resolved prompt',
        changeSummary: 'V1',
        referenceAssetIds: [inputAsset.id],
        termPromptLocale: 'zh',
        termIds: ['term-direct'],
        wordPaletteReferences: [
          {
            paletteId: 'recipe-main',
            paletteRevisionId: 'recipe-main:v1',
            parameterValues: {},
            promptLocale: 'zh',
          },
        ],
        modelKey: 'model-a',
        canvasPresetKey: null,
        width: null,
        height: null,
        quality: 'low',
      });
      library.database.db
        .prepare(
          `UPDATE generation_runs
        SET status = 'SUCCEEDED', result_asset_id = ? WHERE id = ?`,
        )
        .run(asset.id, generation.runId);
      const secondRun = library.database.prepareGenerationFromVersion(generation.versionId, 'model-b');
      library.database.db
        .prepare(
          `UPDATE generation_runs
        SET status = 'SUCCEEDED', result_asset_id = ? WHERE id = ?`,
        )
        .run(asset.id, secondRun.runId);

      library.database.db
        .prepare(
          `INSERT INTO creation_output_imports
        (id, batch_id, series_id, prompt_version_id, image_asset_id, source_type,
         original_name, display_name, created_at, deleted_at)
        VALUES ('import-linked', 'batch-linked', ?, ?, ?, 'UPLOAD', 'linked.png', 'linked.png', ?, NULL),
          ('import-unlinked', 'batch-unlinked', ?, NULL, ?, 'UPLOAD', 'unlinked.png', 'unlinked.png', ?, NULL)`,
        )
        .run(
          generation.seriesId,
          generation.versionId,
          asset.id,
          '2026-07-30T00:04:00.000Z',
          generation.seriesId,
          asset.id,
          '2026-07-30T00:05:00.000Z',
        );

      for (const [index, termId] of ['term-direct', 'term-nested'].entries()) {
        library.database.db
          .prepare(
            `INSERT INTO term_evidence
          (id, term_id, image_asset_id, verdict, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `evidence-${index}`,
            termId,
            asset.id,
            index === 0 ? 'SUPPORTS' : 'CONTRADICTS',
            `note-${index}`,
            `2026-07-30T00:0${index + 6}:00.000Z`,
          );
        library.database.db
          .prepare(
            `INSERT INTO term_media_links
          (id, term_id, image_asset_id, role, sort_order, focal_x, focal_y, created_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, 0.5, 0.5, ?, NULL)`,
          )
          .run(
            `media-${index}`,
            termId,
            asset.id,
            index === 0 ? 'COVER' : 'RELATED',
            index,
            `2026-07-30T00:0${index + 8}:00.000Z`,
          );
      }

      const relationships = library.database.getAssetRelationship(asset.id);

      expect(relationships.creations).toHaveLength(4);
      expect(
        relationships.creations.filter((item) => item.kind === 'GENERATION_RUN').map((item) => item.runId),
      ).toEqual(expect.arrayContaining([generation.runId, secondRun.runId]));
      expect(relationships.creations.filter((item) => item.kind === 'GENERATION_RUN')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            series: expect.objectContaining({ id: generation.seriesId }),
            promptVersion: expect.objectContaining({ id: generation.versionId, versionNo: 1 }),
          }),
        ]),
      );
      expect(relationships.creations.find((item) => item.importedOutputId === 'import-unlinked')).toMatchObject({
        runId: null,
        promptVersion: null,
      });
      expect(relationships.creations.find((item) => item.importedOutputId === 'import-linked')).toMatchObject({
        runId: null,
        promptVersion: { id: generation.versionId },
      });

      const generated = relationships.creations.find((item) => item.runId === generation.runId)!;
      expect(generated.directTerms).toEqual([
        expect.objectContaining({ termId: 'term-direct', termRevisionId: 'term-direct:v1' }),
      ]);
      expect(generated.recipes).toEqual([
        expect.objectContaining({ paletteId: 'recipe-main', paletteRevisionId: 'recipe-main:v1' }),
      ]);
      expect(generated.recipes[0]).not.toHaveProperty('terms');
      expect(generated.inputPackSources.map((item) => item.pack.packId)).toEqual(
        expect.arrayContaining([
          directTermPack.packId,
          nestedTermPack.packId,
          recipePack.packId,
          inputAssetPack.packId,
        ]),
      );
      expect(generated.inputPackSources.find((item) => item.pack.packId === nestedTermPack.packId)?.viaRecipes).toEqual(
        [
          expect.objectContaining({
            paletteId: 'recipe-main',
            sourceKinds: ['NESTED_TERM'],
          }),
        ],
      );
      expect(
        generated.inputPackSources.find((item) => item.pack.packId === directTermPack.packId)?.viaDirectTerms,
      ).toEqual([expect.objectContaining({ termId: 'term-direct' })]);
      expect(
        generated.inputPackSources.find((item) => item.pack.packId === inputAssetPack.packId)?.viaReferences,
      ).toEqual(
        expect.arrayContaining([
          { assetId: inputAsset.id, role: 'DIRECT_REFERENCE', recipeUseId: null },
          { assetId: inputAsset.id, role: 'RECIPE_REFERENCE', recipeUseId: 'recipe-main:recipe-main:v1' },
        ]),
      );

      expect(relationships.termRelationships.map((item) => `${item.kind}:${item.id}`)).toEqual(
        expect.arrayContaining(['EVIDENCE:evidence-0', 'EVIDENCE:evidence-1', 'MEDIA:media-0', 'MEDIA:media-1']),
      );
      expect(relationships.directPackSources.map((item) => item.pack.packId)).toEqual(
        expect.arrayContaining([directAssetPack.packId, directMaterialPack.packId]),
      );
      expect(relationships.directPackSources.map((item) => item.pack.packId)).not.toContain(recipePack.packId);
    } finally {
      library.cleanup();
    }
  });
});
