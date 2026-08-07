import { afterEach, describe, expect, it } from 'vitest';
import { chmod, copyFile, readFile, stat } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AssetFileActions } from '../src/main/asset-file-actions';
import { LibraryDatabase } from '../src/main/database';
import { safeAssetFileName } from '../src/main/database/asset-file-repository';

const roots: string[] = [];
const databases: LibraryDatabase[] = [];
const pngBytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('asset-bytes')]);

function openLibrary() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aibd-asset-files-'));
  roots.push(root);
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  databases.push(database);
  database.initialize();
  return { root, database };
}

function addAsset(
  database: LibraryDatabase,
  root: string,
  input: {
    id: string;
    relativePath?: string;
    mimeType?: string;
    deletedAt?: string | null;
  },
) {
  const relativePath = input.relativePath ?? path.join('objects', 'sha256', input.id.slice(0, 2), `${input.id}.png`);
  const absolutePath = path.resolve(root, relativePath);
  if (!input.relativePath) {
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, pngBytes);
  }
  database.db
    .prepare(
      `INSERT INTO image_assets
    (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
    VALUES (?, 'REFERENCE', 'LOCAL_IMPORT', ?, ?, 1, 1, ?, 11, ?, ?)`,
    )
    .run(
      input.id,
      input.id.padEnd(64, '0').slice(0, 64),
      relativePath,
      input.mimeType ?? 'image/png',
      '2026-07-30T00:00:00.000Z',
      input.deletedAt ?? null,
    );
  return absolutePath;
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      // Individual tests may already have closed the handle.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('asset file boundary', () => {
  it('resolves only active, existing image_assets inside the current local space', () => {
    const { root, database } = openLibrary();
    const validPath = addAsset(database, root, { id: 'valid_asset' });
    addAsset(database, root, { id: 'deleted_asset', deletedAt: '2026-07-30T01:00:00.000Z' });
    addAsset(database, root, { id: 'missing_asset', relativePath: path.join('objects', 'missing.png') });
    addAsset(database, root, { id: 'outside_asset', relativePath: path.join('..', 'outside.png') });
    const executableRelativePath = path.join('objects', 'disguised.exe');
    mkdirSync(path.dirname(path.join(root, executableRelativePath)), { recursive: true });
    writeFileSync(path.join(root, executableRelativePath), Buffer.from('MZ executable'));
    addAsset(database, root, { id: 'executable_asset', relativePath: executableRelativePath });
    const invalidImageRelativePath = path.join('objects', 'invalid.png');
    writeFileSync(path.join(root, invalidImageRelativePath), Buffer.from('not an image'));
    addAsset(database, root, { id: 'invalid_image_asset', relativePath: invalidImageRelativePath });

    expect(database.resolveAssetFile('valid_asset')).toMatchObject({
      assetId: 'valid_asset',
      absolutePath: validPath,
      extension: '.png',
      mimeType: 'image/png',
      suggestedName: 'valid_asset.png',
    });
    expect(database.resolveAssetFile('deleted_asset')).toBeNull();
    expect(database.resolveAssetFile('missing_asset')).toBeNull();
    expect(database.resolveAssetFile('outside_asset')).toBeNull();
    expect(database.resolveAssetFile('executable_asset')).toBeNull();
    expect(database.resolveAssetFile('invalid_image_asset')).toBeNull();
    expect(database.resolveAssetFile('unknown_asset')).toBeNull();
    database.close();
  });

  it('sanitizes user-facing export names and preserves the verified image extension', () => {
    expect(safeAssetFileName('../../CON.exe', 'image-safe', '.png')).toBe('image-safe.png');
    expect(safeAssetFileName('portrait:*?  .jpg', 'image-safe', '.webp')).toBe('portrait.webp');
    expect(safeAssetFileName('NUL', 'image-safe', '.jpg')).toBe('image-safe.jpg');
  });

  it('uses the owning creation title for generated image filenames', () => {
    const { root, database } = openLibrary();
    addAsset(database, root, { id: 'generated_asset' });
    database.db
      .prepare(
        `INSERT INTO prompt_series
      (id, title, current_version_id, created_at, deleted_at, title_zh, title_en)
      VALUES ('series-name', '夏日造型', NULL, ?, NULL, '夏日造型', 'Summer styling')`,
      )
      .run('2026-07-30T00:01:00.000Z');
    database.db
      .prepare(
        `INSERT INTO prompt_versions
      (id, series_id, parent_version_id, version_no, user_intent, final_prompt,
        change_summary, source_image_id, content_hash, created_at)
      VALUES ('version-name', 'series-name', NULL, 3, '', '', '', NULL, 'version-hash', ?)`,
      )
      .run('2026-07-30T00:02:00.000Z');
    database.db
      .prepare(
        `INSERT INTO generation_runs
      (id, prompt_version_id, model_key, width, height, quality, status,
        result_asset_id, error_code, error_message, started_at, finished_at, created_at)
      VALUES ('run-name', 'version-name', 'test-model', 1, 1, 'low', 'SUCCEEDED',
        'generated_asset', NULL, NULL, ?, ?, ?)`,
      )
      .run('2026-07-30T00:03:00.000Z', '2026-07-30T00:03:01.000Z', '2026-07-30T00:03:00.000Z');

    expect(database.resolveAssetFile('generated_asset')?.suggestedName).toBe('夏日造型.png');
    database.close();
  });

  it('copies through the native save selection and never receives a source path from renderer', async () => {
    const { root, database } = openLibrary();
    const sourcePath = addAsset(database, root, { id: 'export_asset' });
    const destinationPath = path.join(root, 'downloaded.png');
    const revealed: string[] = [];
    const opened: string[] = [];
    const revealContexts: unknown[] = [];
    const actions = new AssetFileActions(
      (assetId) => database.resolveAssetFile(assetId),
      {
        showSaveDialog: async (options) => {
          expect(options.defaultPath).toBe('export_asset.png');
          expect(options.filters).toEqual([{ name: 'Image', extensions: ['png'] }]);
          return { canceled: false, filePath: destinationPath };
        },
        copyFile: async (source, destination) => {
          await copyFile(source, destination);
          await chmod(destination, 0o644);
        },
        showItemInFolder: (filePath) => {
          revealed.push(filePath);
        },
        openPath: async (filePath) => {
          opened.push(filePath);
          return '';
        },
      },
      (asset, context) => {
        revealContexts.push(context);
        return path.join(root, context.kind === 'ALBUM' ? '图集' : '全部素材', asset.suggestedName);
      },
    );

    expect(actions.availability('export_asset')).toEqual({ available: true });
    await expect(actions.saveAs('export_asset')).resolves.toEqual({ status: 'saved' });
    expect(await readFile(destinationPath)).toEqual(pngBytes);
    expect((await stat(destinationPath)).mode & 0o200).not.toBe(0);
    actions.reveal('export_asset');
    actions.reveal('export_asset', { kind: 'ALBUM', albumId: 'album-one' });
    await actions.open('export_asset');
    expect(revealContexts).toEqual([{ kind: 'ALL_MATERIALS' }, { kind: 'ALBUM', albumId: 'album-one' }]);
    expect(revealed).toEqual([
      path.join(root, '全部素材', 'export_asset.png'),
      path.join(root, '图集', 'export_asset.png'),
    ]);
    expect(opened).toEqual([sourcePath]);
    database.close();
  });

  it('fails closed when an asset is deleted, missing, or given an incompatible destination extension', async () => {
    const { root, database } = openLibrary();
    addAsset(database, root, { id: 'volatile_asset' });
    let destinationPath = path.join(root, 'unsafe.exe');
    const actions = new AssetFileActions((assetId) => database.resolveAssetFile(assetId), {
      showSaveDialog: async () => ({ canceled: false, filePath: destinationPath }),
      copyFile,
      showItemInFolder: () => undefined,
      openPath: async () => '',
    });

    await expect(actions.saveAs('volatile_asset')).rejects.toThrow('File extension must be .png');
    database.db
      .prepare('UPDATE image_assets SET deleted_at = ? WHERE id = ?')
      .run('2026-07-30T02:00:00.000Z', 'volatile_asset');
    expect(actions.availability('volatile_asset')).toEqual({ available: false });
    await expect(actions.open('volatile_asset')).rejects.toThrow('Asset file is unavailable');
    destinationPath = path.join(root, 'unused.png');
    await expect(actions.saveAs('volatile_asset')).rejects.toThrow('Asset file is unavailable');
    database.close();
  });
});
