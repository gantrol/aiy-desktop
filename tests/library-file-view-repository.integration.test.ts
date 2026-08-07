import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '@/main/database';

const roots: string[] = [];
const databases: LibraryDatabase[] = [];
const createdAt = '2026-07-31T00:00:00.000Z';
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

interface AssetFixture {
  assetId: string;
  materialId: string;
  sourcePath: string;
}

function openLibrary() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'aibd-library-file-view-')));
  roots.push(root);
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  databases.push(database);
  database.initialize();
  return { database, root };
}

function addAsset(
  database: LibraryDatabase,
  root: string,
  assetId: string,
  displayName = `${assetId}.png`,
  kind: 'REFERENCE' | 'GENERATED' = 'REFERENCE',
): AssetFixture {
  const bytes = Buffer.concat([pngSignature, Buffer.from(`fixture:${assetId}`)]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const relativePath = path.join('objects', 'sha256', hash.slice(0, 2), `${hash}.png`);
  const sourcePath = path.resolve(root, relativePath);
  mkdirSync(path.dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, bytes);

  database.db
    .prepare(
      `INSERT INTO image_assets
    (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
    VALUES (?, ?, 'TEST', ?, ?, 1, 1, 'image/png', ?, ?, NULL)`,
    )
    .run(assetId, kind, hash, relativePath, bytes.byteLength, createdAt);

  const materialId = `material-${assetId}`;
  database.db
    .prepare(
      `INSERT INTO materials
    (id, kind, image_asset_id, text_content, content_hash, source_type, created_at, deleted_at)
    VALUES (?, 'IMAGE', ?, NULL, ?, 'UPLOAD', ?, NULL)`,
    )
    .run(materialId, assetId, hash, createdAt);
  database.db
    .prepare(
      `INSERT INTO external_material_metadata
    (material_id, original_name, display_name, updated_at)
    VALUES (?, ?, ?, ?)`,
    )
    .run(materialId, displayName, displayName, createdAt);

  return { assetId, materialId, sourcePath };
}

function addMaterialToAlbum(database: LibraryDatabase, albumId: string, materialId: string) {
  database.addAlbumMembers({
    albumId,
    members: [{ targetType: 'MATERIAL', targetId: materialId }],
  });
}

function expectHardLink(sourcePath: string, projectedPath: string) {
  expect(projectedPath).not.toBe(sourcePath);
  expect(existsSync(projectedPath)).toBe(true);
  expect(lstatSync(projectedPath).isSymbolicLink()).toBe(false);
  const source = statSync(sourcePath, { bigint: true });
  const projected = statSync(projectedPath, { bigint: true });
  expect(projected.dev).toBe(source.dev);
  expect(projected.ino).toBe(source.ino);
  expect(projected.nlink).toBeGreaterThanOrEqual(2n);
  expect(source.mode & 0o222n).toBe(0n);
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('library file view repository', { timeout: 60_000 }, () => {
  it('waits for an active background synchronization before the library can close', async () => {
    const { database } = openLibrary();
    let releaseSynchronization!: () => void;
    let markStarted!: () => void;
    const synchronizationGate = new Promise<void>((resolve) => {
      releaseSynchronization = resolve;
    });
    const synchronizationStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    database.setLibraryFileViewBackgroundSynchronizer(async () => {
      markStarted();
      await synchronizationGate;
    });
    database.startLibraryFileViewSynchronization();
    await synchronizationStarted;
    let drained = false;

    const drain = database.drainLibraryFileViewSynchronization().then(() => {
      drained = true;
    });
    await Promise.resolve();

    expect(drained).toBe(false);
    releaseSynchronization();
    await drain;
    expect(drained).toBe(true);
  });

  it('does not create an unscoped all-materials hard link', () => {
    const { database, root } = openLibrary();
    const asset = addAsset(database, root, 'hard-link-asset', 'Hard link.png');

    expect(database.listAssetRevealTargets(asset.assetId, { kind: 'ALL_MATERIALS' })).toEqual([]);
    expect(() => database.resolveAssetRevealPath(asset.assetId, { kind: 'ALL_MATERIALS' })).toThrow(
      'Asset has not been added to an album or dictionary term',
    );
    expect(existsSync(path.join(root, '全部素材'))).toBe(false);
  });

  it('keeps distinct album paths and exposes both aggregate reveal targets', () => {
    const { database, root } = openLibrary();
    const asset = addAsset(database, root, 'shared-asset', 'Shared image.png');
    const albumA = database.createAlbum({ title: 'Album A' });
    const albumB = database.createAlbum({ title: 'Album B' });
    addMaterialToAlbum(database, albumA.id, asset.materialId);
    addMaterialToAlbum(database, albumB.id, asset.materialId);

    const albumAPath = database.resolveAssetRevealPath(asset.assetId, { kind: 'ALBUM', albumId: albumA.id });
    const albumBPath = database.resolveAssetRevealPath(asset.assetId, { kind: 'ALBUM', albumId: albumB.id });

    expect(albumAPath).not.toBeNull();
    expect(albumBPath).not.toBeNull();
    expect(new Set([albumAPath, albumBPath])).toHaveLength(2);
    expect(database.listAssetRevealTargets(asset.assetId, { kind: 'ALL_MATERIALS' })).toHaveLength(2);
    expect(() => database.resolveAssetRevealPath(asset.assetId, { kind: 'ALL_MATERIALS' })).toThrow(
      'Asset has more than one organized directory',
    );
    expect(path.relative(root, albumAPath!).split(path.sep)[0]).toBe('图集');
    expect(path.relative(root, albumBPath!).split(path.sep)[0]).toBe('图集');
    expectHardLink(asset.sourcePath, albumAPath!);
    expectHardLink(asset.sourcePath, albumBPath!);
  });

  it('uses the nearest child source for a parent context and prefers a later direct parent source', () => {
    const { database, root } = openLibrary();
    const asset = addAsset(database, root, 'nested-asset', 'Nested image.png');
    const parent = database.createAlbum({ title: 'Parent' });
    const child = database.createAlbum({ title: 'Child', parentAlbumId: parent.id });
    addMaterialToAlbum(database, child.id, asset.materialId);

    const childPath = database.resolveAssetRevealPath(asset.assetId, { kind: 'ALBUM', albumId: child.id });
    const inheritedParentPath = database.resolveAssetRevealPath(asset.assetId, { kind: 'ALBUM', albumId: parent.id });

    expect(childPath).not.toBeNull();
    expect(inheritedParentPath).toBe(childPath);
    expectHardLink(asset.sourcePath, inheritedParentPath!);

    addMaterialToAlbum(database, parent.id, asset.materialId);
    const directParentPath = database.resolveAssetRevealPath(asset.assetId, { kind: 'ALBUM', albumId: parent.id });

    expect(directParentPath).not.toBeNull();
    expect(directParentPath).not.toBe(childPath);
    expect(path.dirname(directParentPath!)).not.toBe(path.dirname(childPath!));
    expectHardLink(asset.sourcePath, directParentPath!);
  });

  it('projects successful, imported, and reference creation assets and rejects an unrelated asset', () => {
    const { database, root } = openLibrary();
    const generated = addAsset(database, root, 'creation-generated', 'Generated.png', 'GENERATED');
    const imported = addAsset(database, root, 'creation-imported', 'Imported.png');
    const reference = addAsset(database, root, 'creation-reference', 'Reference.png');
    const unrelated = addAsset(database, root, 'creation-unrelated', 'Unrelated.png');
    const owner = database.createAlbum({ title: 'Creation owner' });

    database.db
      .prepare(
        `INSERT INTO prompt_series
      (id, title, current_version_id, created_at, deleted_at, title_zh, title_en)
      VALUES ('fixture-series', 'Fixture series', NULL, ?, NULL, '夹具创作', 'Fixture series')`,
      )
      .run(createdAt);
    database.db
      .prepare(
        `INSERT INTO prompt_versions
      (id, series_id, parent_version_id, version_no, user_intent, final_prompt, change_summary,
       source_image_id, content_hash, created_at)
      VALUES ('fixture-version', 'fixture-series', NULL, 1, 'fixture', 'fixture prompt', 'fixture',
        NULL, 'fixture-version-hash', ?)`,
      )
      .run(createdAt);
    database.db
      .prepare(
        `UPDATE prompt_series SET current_version_id = 'fixture-version'
      WHERE id = 'fixture-series'`,
      )
      .run();
    database.db
      .prepare(
        `INSERT INTO generation_runs
      (id, prompt_version_id, model_key, width, height, quality, status, result_asset_id,
       error_code, error_message, started_at, finished_at, created_at)
      VALUES ('fixture-run', 'fixture-version', 'fixture-model', 1, 1, 'low', 'SUCCEEDED', ?,
        NULL, NULL, ?, ?, ?)`,
      )
      .run(generated.assetId, createdAt, createdAt, createdAt);
    database.db
      .prepare(
        `INSERT INTO creation_output_imports
      (id, batch_id, series_id, prompt_version_id, image_asset_id, source_type,
       original_name, created_at, deleted_at, display_name)
      VALUES ('fixture-import', 'fixture-batch', 'fixture-series', 'fixture-version', ?, 'UPLOAD',
        'Imported.png', ?, NULL, 'Imported.png')`,
      )
      .run(imported.assetId, createdAt);
    database.db
      .prepare(
        `INSERT INTO reference_bindings
      (id, prompt_version_id, image_asset_id, sort_order)
      VALUES ('fixture-reference', 'fixture-version', ?, 0)`,
      )
      .run(reference.assetId);
    database.addAlbumMembers({
      albumId: owner.id,
      members: [{ targetType: 'SERIES', targetId: 'fixture-series' }],
    });

    const generatedPath = database.resolveAssetRevealPath(generated.assetId, {
      kind: 'CREATION',
      seriesId: 'fixture-series',
    });
    const importedPath = database.resolveAssetRevealPath(imported.assetId, {
      kind: 'CREATION',
      seriesId: 'fixture-series',
    });
    const referencePath = database.resolveAssetRevealPath(reference.assetId, {
      kind: 'CREATION',
      seriesId: 'fixture-series',
    });
    expect(generatedPath).not.toBeNull();
    expect(importedPath).not.toBeNull();
    expect(referencePath).not.toBeNull();
    expect(path.dirname(importedPath!)).toBe(path.dirname(generatedPath!));
    expect(path.dirname(referencePath!)).toBe(path.dirname(generatedPath!));
    expect(() =>
      database.resolveAssetRevealPath(unrelated.assetId, {
        kind: 'CREATION',
        seriesId: 'fixture-series',
      }),
    ).toThrow('Asset is missing from the requested managed directory');
    expectHardLink(generated.sourcePath, generatedPath!);
    expectHardLink(imported.sourcePath, importedPath!);
    expectHardLink(reference.sourcePath, referencePath!);
  });

  it('lazily recreates a missing projection link at the same path', () => {
    const { database, root } = openLibrary();
    const asset = addAsset(database, root, 'rebuild-asset', 'Rebuild.png');
    const album = database.createAlbum({ title: 'Rebuild album' });
    addMaterialToAlbum(database, album.id, asset.materialId);
    const context = { kind: 'ALBUM' as const, albumId: album.id };
    const firstPath = database.resolveAssetRevealPath(asset.assetId, context);
    expect(firstPath).not.toBeNull();
    unlinkSync(firstPath!);
    expect(existsSync(firstPath!)).toBe(false);

    const rebuiltPath = database.resolveAssetRevealPath(asset.assetId, context);

    expect(rebuiltPath).toBe(firstPath);
    expectHardLink(asset.sourcePath, rebuiltPath!);
  });

  it('does not overwrite a user file that conflicts with the preferred projection name', () => {
    const { database, root } = openLibrary();
    const asset = addAsset(database, root, 'conflict-asset', 'Conflict.png');
    const album = database.createAlbum({ title: 'Conflict album' });
    addMaterialToAlbum(database, album.id, asset.materialId);
    const context = { kind: 'ALBUM' as const, albumId: album.id };
    const preferredPath = database.resolveAssetRevealPath(asset.assetId, context);
    expect(preferredPath).not.toBeNull();
    unlinkSync(preferredPath!);
    const userBytes = Buffer.from('user-owned-content');
    writeFileSync(preferredPath!, userBytes);
    const userFileBefore = statSync(preferredPath!, { bigint: true });

    const projectedPath = database.resolveAssetRevealPath(asset.assetId, context);

    expect(projectedPath).not.toBeNull();
    expect(projectedPath).not.toBe(preferredPath);
    expect(readFileSync(preferredPath!)).toEqual(userBytes);
    const userFileAfter = statSync(preferredPath!, { bigint: true });
    expect(userFileAfter.dev).toBe(userFileBefore.dev);
    expect(userFileAfter.ino).toBe(userFileBefore.ino);
    expectHardLink(asset.sourcePath, projectedPath!);
  });
});
