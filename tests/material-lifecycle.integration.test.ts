import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureLibraryTemplate } from './support/fixture-library-template';

const template = createFixtureLibraryTemplate({
  prefix: 'aibd-material-lifecycle-',
});

function openDatabase() {
  return template.open();
}

beforeAll(() => template.initialize(), 30_000);
afterEach(() => template.reset());
afterAll(() => template.dispose());

describe('material collection and creation group lifecycle', { timeout: 30_000 }, () => {
  function addTransformedOutput(database: ReturnType<typeof openDatabase>) {
    const createdAt = '2026-07-21T09:23:00.000Z';
    database.db
      .prepare(
        `INSERT INTO image_assets
        (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
        VALUES ('img_011_crop', 'GENERATED', 'LOCAL_TRANSFORM', 'synthetic-transform-hash',
          'objects/synthetic-transform.png', 512, 512, 'image/png', 128, ?, NULL)`,
      )
      .run(createdAt);
    database.db
      .prepare(
        `INSERT INTO image_transform_runs
        (id, series_id, source_asset_id, output_asset_id, kind, ratio_width, ratio_height,
          crop_x, crop_y, crop_width, crop_height, created_at, deleted_at)
        VALUES ('transform_011', 'ps_011', 'img_011', 'img_011_crop', 'CROP', 1, 1,
          0, 0, 512, 512, ?, NULL)`,
      )
      .run(createdAt);
    return 'img_011_crop';
  }

  it('creates static material collections from formal view, group, and series sources', () => {
    const database = openDatabase();
    const transformedAssetId = addTransformedOutput(database);
    const materialViews = database.listMaterialAlbums({ locale: 'en' });
    const groupView = materialViews.find(
      (view) => view.kind === 'SYSTEM' && view.systemKey === 'CREATION_GROUP' && view.materialCount > 0,
    );
    expect(groupView).toBeDefined();

    const sourceAssetIds = database
      .listGallery({
        locale: 'en',
        source: 'ALL',
        albumId: groupView!.id,
        unratedDimensions: [],
        cursor: null,
        limit: 60,
      })
      .items.map((item) => item.asset.id);

    const fromView = database.createMaterialCollectionFromSource({
      source: { kind: 'MATERIAL_VIEW', viewId: groupView!.id },
      snapshot: {
        kind: 'GALLERY_QUERY',
        query: { source: 'ALL', albumId: groupView!.id, unratedDimensions: [] },
      },
      locale: 'en',
    });
    expect(fromView.source).toEqual({ kind: 'MATERIAL_VIEW', viewId: groupView!.id });
    expect(fromView.collection).toMatchObject({ kind: 'USER', readOnly: false, title: groupView!.title });
    expect(fromView.capturedMaterialCount).toBe(groupView!.materialCount);
    expect(fromView.collection.materialCount).toBe(groupView!.materialCount);

    expect(fromView.collection.members.map((member) => member.imageAsset?.id)).toEqual(sourceAssetIds);

    const creationRoot = materialViews.find((view) => view.kind === 'SYSTEM' && view.systemKey === 'CREATION_ROOT')!;
    const creationItems = database.listGallery({
      locale: 'en',
      source: 'ALL',
      albumId: creationRoot.id,
      unratedDimensions: [],
      cursor: null,
      limit: 60,
    }).items;
    const query = creationItems.find((item) => item.creation?.seriesTitle)?.creation?.seriesTitle ?? '';
    const filteredAssetIds = database
      .listGallery({
        locale: 'en',
        source: 'ALL',
        query,
        albumId: creationRoot.id,
        unratedDimensions: [],
        cursor: null,
        limit: 60,
      })
      .items.map((item) => item.asset.id);
    const filteredSnapshot = database.createMaterialCollectionFromSource({
      source: { kind: 'MATERIAL_VIEW', viewId: creationRoot.id },
      snapshot: {
        kind: 'GALLERY_QUERY',
        query: { source: 'ALL', query, albumId: creationRoot.id, unratedDimensions: [] },
      },
      title: 'Filtered snapshot',
      locale: 'en',
    });
    expect(filteredAssetIds.length).toBeGreaterThan(0);
    expect(filteredSnapshot.collection.members.map((member) => member.imageAsset?.id)).toEqual(filteredAssetIds);

    const fromGroup = database.createMaterialCollectionFromSource({
      source: { kind: 'CREATION_GROUP', creationGroupId: groupView!.sourceAlbumId! },
      snapshot: { kind: 'ORDERED_ASSETS', imageAssetIds: sourceAssetIds },
      title: 'Group snapshot',
      locale: 'en',
    });
    expect(fromGroup.collection.title).toBe('Group snapshot');
    expect(fromGroup.collection.members.map((member) => member.imageAsset?.id)).toEqual(sourceAssetIds);
    expect(
      database.db.prepare('SELECT deleted_at deletedAt FROM albums WHERE id = ?').get(groupView!.sourceAlbumId),
    ).toEqual({ deletedAt: null });

    const seriesAssetIds = database
      .listGallery({
        locale: 'en',
        source: 'CREATION',
        unratedDimensions: [],
        cursor: null,
        limit: 60,
      })
      .items.filter((item) => item.creation?.seriesId === 'ps_011')
      .map((item) => item.asset.id);
    const fromSeries = database.createMaterialCollectionFromSource({
      source: { kind: 'PROMPT_SERIES', seriesId: 'ps_011' },
      snapshot: { kind: 'ORDERED_ASSETS', imageAssetIds: [...seriesAssetIds, transformedAssetId] },
      locale: 'zh',
    });
    expect(fromSeries.capturedMaterialCount).toBeGreaterThan(0);
    expect(fromSeries.collection.members.map((member) => member.imageAsset?.id)).toContain('img_011');
    expect(fromSeries.collection.members.map((member) => member.imageAsset?.id)).toContain(transformedAssetId);
    expect(database.db.prepare('SELECT deleted_at deletedAt FROM prompt_series WHERE id = ?').get('ps_011')).toEqual({
      deletedAt: null,
    });
    const outsideSeriesAssetId = sourceAssetIds.find((assetId) => !seriesAssetIds.includes(assetId));
    if (outsideSeriesAssetId) {
      expect(() =>
        database.createMaterialCollectionFromSource({
          source: { kind: 'PROMPT_SERIES', seriesId: 'ps_011' },
          snapshot: { kind: 'ORDERED_ASSETS', imageAssetIds: [outsideSeriesAssetId] },
          locale: 'en',
        }),
      ).toThrow('outside its source');
    }

    const emptySeries = database.prepareGeneration({
      seriesId: null,
      title: '空创作',
      manualPrompt: 'portrait',
      prompt: 'portrait',
      changeSummary: '',
      referenceAssetIds: [],
      termIds: [],
      wordPaletteReferences: [],
      termPromptLocale: 'en',
      modelKey: 'gpt-image-2',
      canvasPresetKey: null,
      width: 1024,
      height: 1024,
      quality: 'low',
    });
    const albumCountBefore = database.db.prepare('SELECT count(*) count FROM albums WHERE deleted_at IS NULL').get();
    expect(() =>
      database.createMaterialCollectionFromSource({
        source: { kind: 'PROMPT_SERIES', seriesId: emptySeries.seriesId },
        snapshot: { kind: 'ORDERED_ASSETS', imageAssetIds: [] },
        locale: 'en',
      }),
    ).toThrow('source has no materials');
    expect(database.db.prepare('SELECT count(*) count FROM albums WHERE deleted_at IS NULL').get()).toEqual(
      albumCountBefore,
    );

    database.deleteAlbum(groupView!.sourceAlbumId!);
    const savedAfterSourceDeletion = database
      .listMaterialAlbums({ locale: 'en' })
      .find((album) => album.id === fromView.collection.id);
    expect(savedAfterSourceDeletion?.members.map((member) => member.imageAsset?.id)).toEqual(sourceAssetIds);
  });
});
