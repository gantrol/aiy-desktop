import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureLibraryTemplate } from './support/fixture-library-template';

const template = createFixtureLibraryTemplate({
  prefix: 'aibd-album-repository-',
});

function openDatabase() {
  return template.open();
}

beforeAll(() => template.initialize(), 30_000);
afterEach(() => template.reset());
afterAll(() => template.dispose());

describe('album repository', { timeout: 60_000 }, () => {
  it('promotes a bare image asset to a material when adding it to an album', () => {
    const database = openDatabase();
    database.db
      .prepare(
        `INSERT INTO image_assets
      (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
      VALUES ('album-bare-asset', 'REFERENCE', 'TEST', 'album-bare-hash', 'objects/test.png', 16, 16, 'image/png', 1, '2026-07-30T00:00:00Z', NULL)`,
      )
      .run();
    const album = database.createAlbum({ title: 'References' });

    const updated = database.addAlbumMembers({
      albumId: album.id,
      members: [{ targetType: 'MATERIAL', targetId: 'album-bare-asset' }],
    });
    const member = updated.members.find((item) => item.targetType === 'MATERIAL');

    expect(member?.imageAsset?.id).toBe('album-bare-asset');
    expect(member?.targetId).not.toBe('album-bare-asset');
    expect(database.db.prepare(`SELECT image_asset_id FROM materials WHERE id = ?`).get(member?.targetId)).toEqual({
      image_asset_id: 'album-bare-asset',
    });
    expect(
      database.addAlbumMembers({
        albumId: album.id,
        members: [{ targetType: 'MATERIAL', targetId: 'album-bare-asset' }],
      }).materialCount,
    ).toBe(1);
  });

  it('moves an album between parents and rejects hierarchy cycles', () => {
    const database = openDatabase();
    const firstParent = database.createAlbum({ title: 'First' });
    const secondParent = database.createAlbum({ title: 'Second' });
    const child = database.createAlbum({ title: 'Child', parentAlbumId: firstParent.id });

    expect(database.listAlbums().find((item) => item.id === firstParent.id)?.members).toEqual(
      expect.arrayContaining([expect.objectContaining({ targetType: 'ALBUM', targetId: child.id })]),
    );
    const originalEdge = database.db
      .prepare(
        `SELECT id FROM album_members
      WHERE album_id = ? AND target_type = 'ALBUM' AND target_id = ? AND deleted_at IS NULL`,
      )
      .get(firstParent.id, child.id) as { id: string };
    database.moveAlbum({ albumId: child.id, parentAlbumId: firstParent.id });
    expect(
      database.db
        .prepare(
          `SELECT count(*) AS count FROM tombstones
      WHERE entity_type = 'ALBUM_MEMBER' AND entity_id = ?`,
        )
        .get(originalEdge.id),
    ).toEqual({ count: 0 });

    const albumCount = database.listAlbums().length;
    expect(() => database.createAlbum({ title: 'Orphan', parentAlbumId: 'missing-parent' })).toThrow('Album not found');
    expect(database.listAlbums()).toHaveLength(albumCount);

    database.moveAlbum({ albumId: child.id, parentAlbumId: secondParent.id });
    const parents = database.db
      .prepare(
        `SELECT album_id FROM album_members
      WHERE target_type = 'ALBUM' AND target_id = ? AND deleted_at IS NULL`,
      )
      .all(child.id);
    expect(parents).toEqual([{ album_id: secondParent.id }]);
    expect(() => database.moveAlbum({ albumId: secondParent.id, parentAlbumId: child.id })).toThrow('descendant');
    expect(() => database.moveAlbum({ albumId: child.id, parentAlbumId: child.id })).toThrow('itself');

    database.moveAlbum({ albumId: child.id, parentAlbumId: null });
    expect(
      database.db
        .prepare(
          `SELECT count(*) AS count FROM album_members
      WHERE target_type = 'ALBUM' AND target_id = ? AND deleted_at IS NULL`,
        )
        .get(child.id),
    ).toEqual({ count: 0 });
  });

  it('projects child materials and creation outputs through one recursive rule', async () => {
    const database = openDatabase();
    const creationAssets = database
      .listGallery({
        locale: 'en',
        source: 'CREATION',
        unratedDimensions: [],
        cursor: null,
        limit: 60,
      })
      .items.filter((item) => item.creation?.seriesId === 'ps_011');
    expect(creationAssets.length).toBeGreaterThan(0);

    await database.commitIntake({
      intent: 'IMPORT',
      source: 'PASTE',
      favorite: true,
      items: [{ id: 'projected-text', kind: 'TEXT', text: 'Projected note' }],
    });
    const textMaterial = database.listFavoriteTexts().find((item) => item.text === 'Projected note')!;
    const parent = database.createAlbum({ title: 'Parent' });
    const child = database.createAlbum({ title: 'Child' });
    database.addAlbumMembers({
      albumId: child.id,
      members: [
        { targetType: 'SERIES', targetId: 'ps_011' },
        { targetType: 'MATERIAL', targetId: textMaterial.id },
      ],
    });
    database.addAlbumMembers({
      albumId: parent.id,
      members: [
        { targetType: 'ALBUM', targetId: child.id },
        { targetType: 'MATERIAL', targetId: creationAssets[0].asset.id },
      ],
    });

    const projected = database.listAlbums().find((album) => album.id === parent.id)!;
    expect(projected.seriesCount).toBe(1);
    expect(projected.materialCount).toBe(new Set(creationAssets.map((item) => item.asset.id)).size + 1);
    expect(database.listAlbumTextMaterials(parent.id)).toEqual([
      expect.objectContaining({ id: textMaterial.id, text: 'Projected note' }),
    ]);
    expect(
      database
        .listGallery({
          locale: 'en',
          source: 'ALL',
          albumId: parent.id,
          unratedDimensions: [],
          cursor: null,
          limit: 60,
        })
        .items.map((item) => item.asset.id)
        .sort(),
    ).toEqual([...new Set(creationAssets.map((item) => item.asset.id))].sort());

    database.setAlbumArchived({ albumId: child.id, archived: true });
    expect(database.listAlbums().find((album) => album.id === parent.id)?.materialCount).toBe(projected.materialCount);
  });

  it('prefers the first cover from each conversation and caps album previews at five', () => {
    const database = openDatabase();
    const album = database.createAlbum({ title: 'Conversation covers' });
    const seriesIds = (
      database.db
        .prepare(
          `SELECT series.id
      FROM prompt_series series
      WHERE series.deleted_at IS NULL AND (
        EXISTS (SELECT 1 FROM prompt_versions version
          JOIN generation_runs run ON run.prompt_version_id = version.id
          WHERE version.series_id = series.id AND run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM creation_output_imports imported
          WHERE imported.series_id = series.id AND imported.deleted_at IS NULL)
      ) ORDER BY series.id LIMIT 5`,
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
    expect(seriesIds.length).toBeGreaterThan(1);

    const firstCover = database.db.prepare(`SELECT id FROM (
      SELECT run.result_asset_id AS id, run.created_at AS created_at
      FROM prompt_versions version
      JOIN generation_runs run ON run.prompt_version_id = version.id
      WHERE version.series_id = ? AND run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
      UNION ALL
      SELECT imported.image_asset_id AS id, imported.created_at AS created_at
      FROM creation_output_imports imported
      WHERE imported.series_id = ? AND imported.deleted_at IS NULL
    ) ORDER BY created_at, id LIMIT 1`);
    const expectedCovers = seriesIds.flatMap((seriesId) => {
      const row = firstCover.get(seriesId, seriesId) as { id: string } | undefined;
      return row ? [row.id] : [];
    });
    const placeholders = expectedCovers.map(() => '?').join(', ');
    const supplementalAssetIds = (
      database.db
        .prepare(
          `SELECT id FROM image_assets
      WHERE deleted_at IS NULL AND id NOT IN (${placeholders}) ORDER BY id LIMIT 3`,
        )
        .all(...expectedCovers) as Array<{ id: string }>
    ).map((row) => row.id);
    database.addAlbumMembers({
      albumId: album.id,
      members: [
        ...seriesIds.map((targetId) => ({ targetType: 'SERIES' as const, targetId })),
        ...supplementalAssetIds.map((targetId) => ({ targetType: 'MATERIAL' as const, targetId })),
      ],
    });
    const previewIds = database
      .listAlbums()
      .find((item) => item.id === album.id)!
      .previewAssets.map((asset) => asset.id);

    expect(previewIds).toHaveLength(5);
    expect(previewIds).toEqual(expect.arrayContaining(expectedCovers));
  });

  it('moves a creation between albums instead of duplicating its direct ownership', () => {
    const database = openDatabase();
    const first = database.createAlbum({ title: 'First owner' });
    const second = database.createAlbum({ title: 'Second owner' });

    database.addAlbumMembers({
      albumId: first.id,
      members: [{ targetType: 'SERIES', targetId: 'ps_011' }],
    });
    database.addAlbumMembers({
      albumId: second.id,
      members: [{ targetType: 'SERIES', targetId: 'ps_011' }],
    });

    expect(
      database.db
        .prepare(
          `SELECT album_id albumId FROM album_members
      WHERE target_type = 'SERIES' AND target_id = 'ps_011' AND deleted_at IS NULL`,
        )
        .all(),
    ).toEqual([{ albumId: second.id }]);
    const albums = database.listAlbums();
    expect(albums.find((album) => album.id === first.id)?.seriesCount).toBe(0);
    expect(albums.find((album) => album.id === second.id)?.seriesCount).toBe(1);
    expect(() =>
      database.db
        .prepare(
          `INSERT INTO album_members
      (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
      VALUES ('duplicate-owner', ?, 'SERIES', 'ps_011', 99, '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z', NULL)`,
        )
        .run(first.id),
    ).toThrow('UNIQUE');
  });

  it('sorts by recursive content activity while keeping pinned albums first', () => {
    const database = openDatabase();
    const parent = database.createAlbum({ title: 'Parent' });
    const child = database.createAlbum({ title: 'Child' });
    const recent = database.createAlbum({ title: 'Recent' });
    const pinned = database.createAlbum({ title: 'Pinned' });
    database.moveAlbum({ albumId: child.id, parentAlbumId: parent.id });
    database.setAlbumPinned({ albumId: pinned.id, pinned: true });

    database.db
      .prepare('UPDATE albums SET content_updated_at = ? WHERE id = ?')
      .run('2030-01-03T00:00:00.000Z', child.id);
    database.db
      .prepare('UPDATE albums SET content_updated_at = ? WHERE id = ?')
      .run('2030-01-02T00:00:00.000Z', recent.id);
    database.db
      .prepare('UPDATE albums SET content_updated_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', pinned.id);

    const albums = database.listAlbums();
    const relevant = albums.filter((album) => [parent.id, recent.id, pinned.id].includes(album.id));
    expect(relevant.map((album) => album.id)).toEqual([pinned.id, parent.id, recent.id]);
    expect(relevant.find((album) => album.id === parent.id)?.activityAt).toBe('2030-01-03T00:00:00.000Z');
  });

  it('deleting an album detaches its children and creations without deleting them', () => {
    const database = openDatabase();
    const parent = database.createAlbum({ title: 'Parent' });
    const child = database.createAlbum({ title: 'Child' });
    database.moveAlbum({ albumId: child.id, parentAlbumId: parent.id });
    database.addAlbumMembers({
      albumId: parent.id,
      members: [{ targetType: 'SERIES', targetId: 'ps_011' }],
    });

    database.deleteAlbum(parent.id);

    expect(database.listAlbums().some((album) => album.id === parent.id)).toBe(false);
    expect(database.listAlbums().some((album) => album.id === child.id)).toBe(true);
    expect(
      database.db
        .prepare(
          `SELECT count(*) AS count FROM album_members
      WHERE deleted_at IS NULL AND (album_id = ? OR target_id = ?)`,
        )
        .get(parent.id, parent.id),
    ).toEqual({ count: 0 });
    expect(
      database.db
        .prepare(
          `SELECT count(*) AS count FROM prompt_series
      WHERE id = 'ps_011' AND deleted_at IS NULL`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });
});
