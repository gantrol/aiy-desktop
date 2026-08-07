import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureLibraryTemplate } from './support/fixture-library-template';

const template = createFixtureLibraryTemplate({
  prefix: 'aibd-material-membership-',
});

function openDatabase() {
  return template.open();
}

beforeAll(() => template.initialize(), 30_000);
afterEach(() => template.reset());
afterAll(() => template.dispose());

describe('material membership destinations', { timeout: 60_000 }, () => {
  it('adds one image to multiple albums and terms idempotently', () => {
    const database = openDatabase();
    const candidate = database.db
      .prepare(
        `SELECT term.id AS term_id, asset.id AS asset_id
      FROM terms term CROSS JOIN image_assets asset
      WHERE term.archived_at IS NULL AND asset.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM term_media_links link
          WHERE link.term_id = term.id AND link.image_asset_id = asset.id AND link.deleted_at IS NULL
        )
      LIMIT 1`,
      )
      .get() as { term_id: string; asset_id: string };
    const first = database.createAlbum({ title: 'First' });
    const second = database.createAlbum({ title: 'Second' });

    const added = database.addMaterialsToDestinations({
      targets: [{ kind: 'IMAGE_ASSET', imageAssetId: candidate.asset_id }],
      albumIds: [first.id, second.id, first.id],
      termIds: [candidate.term_id, candidate.term_id],
    });

    expect(added.albumIds).toEqual([first.id, second.id]);
    expect(added.termIds).toEqual([candidate.term_id]);
    expect(added.addedAlbumMembershipCount).toBe(2);
    expect(added.addedTermMediaCount).toBe(1);
    expect(database.listAlbums().filter((album) => [first.id, second.id].includes(album.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, materialCount: 1 }),
        expect.objectContaining({ id: second.id, materialCount: 1 }),
      ]),
    );
    expect(
      database.db
        .prepare(
          `SELECT count(*) AS count FROM term_media_links
      WHERE term_id = ? AND image_asset_id = ? AND deleted_at IS NULL`,
        )
        .get(candidate.term_id, candidate.asset_id),
    ).toEqual({ count: 1 });

    const repeated = database.addMaterialsToDestinations({
      targets: [{ kind: 'IMAGE_ASSET', imageAssetId: candidate.asset_id }],
      albumIds: [first.id, second.id],
      termIds: [candidate.term_id],
    });
    expect(repeated.addedAlbumMembershipCount).toBe(0);
    expect(repeated.addedTermMediaCount).toBe(0);
  });

  it('rolls album additions back when a later destination is invalid', () => {
    const database = openDatabase();
    const asset = database.db.prepare(`SELECT id FROM image_assets WHERE deleted_at IS NULL LIMIT 1`).get() as {
      id: string;
    };
    const album = database.createAlbum({ title: 'Atomic' });

    expect(() =>
      database.addMaterialsToDestinations({
        targets: [{ kind: 'IMAGE_ASSET', imageAssetId: asset.id }],
        albumIds: [album.id],
        termIds: ['missing-term'],
      }),
    ).toThrow('Active term not found');

    expect(database.listAlbums().find((item) => item.id === album.id)?.materialCount).toBe(0);
  });

  it('adds an image to a material-library album through the aggregate destination API', () => {
    const database = openDatabase();
    const asset = database.db.prepare(`SELECT id FROM image_assets WHERE deleted_at IS NULL LIMIT 1`).get() as {
      id: string;
    };
    const album = database.createMaterialAlbum({ title: 'Material destination' });

    const result = database.addMaterialsToDestinations({
      targets: [{ kind: 'IMAGE_ASSET', imageAssetId: asset.id }],
      albumIds: [album.id],
      termIds: [],
    });

    expect(result.addedAlbumMembershipCount).toBe(1);
    expect(result.albumMaterialCounts).toEqual({ [album.id]: 1 });
    expect(database.listMaterialAlbums({ locale: 'en' }).find((item) => item.id === album.id)?.materialCount).toBe(1);
  });

  it('creates a canonical album and captures the current materials atomically', () => {
    const database = openDatabase();
    const assets = database.db
      .prepare(
        `SELECT id FROM image_assets
      WHERE deleted_at IS NULL ORDER BY id LIMIT 2`,
      )
      .all() as Array<{ id: string }>;

    const result = database.createAlbumFromMaterials({
      title: 'Current outputs',
      targets: assets.map((asset) => ({ kind: 'IMAGE_ASSET' as const, imageAssetId: asset.id })),
    });

    expect(result.capturedMaterialCount).toBe(2);
    expect(result.album).toMatchObject({ title: 'Current outputs', materialCount: 2 });
    expect(
      database.db
        .prepare(
          `SELECT count(*) AS count FROM album_members
      WHERE album_id = ? AND target_type = 'MATERIAL' AND deleted_at IS NULL`,
        )
        .get(result.album.id),
    ).toEqual({ count: 2 });

    const albumCount = database.listAlbums().length;
    expect(() =>
      database.createAlbumFromMaterials({
        title: 'Must roll back',
        targets: [{ kind: 'IMAGE_ASSET', imageAssetId: 'missing-asset' }],
      }),
    ).toThrow('Image asset not found');
    expect(database.listAlbums()).toHaveLength(albumCount);
  });
});
