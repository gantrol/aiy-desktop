import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';
import { imageDimensions } from '@/main/media/image-dimensions';
import { trimTrailingCharacters } from '@/shared/string-boundaries';

export interface ResolvedAssetFile {
  assetId: string;
  objectHash: string;
  absolutePath: string;
  suggestedName: string;
  extension: '.png' | '.jpg' | '.webp' | '.gif' | '.svg' | '.mp4' | '.webm' | '.mov';
  mimeType:
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp'
    | 'image/gif'
    | 'image/svg+xml'
    | 'video/mp4'
    | 'video/webm'
    | 'video/quicktime';
  width: number;
  height: number;
  byteSize: number;
}

const imageFileTypes = {
  'image/png': { extension: '.png', acceptedExtensions: ['.png'] },
  'image/jpeg': { extension: '.jpg', acceptedExtensions: ['.jpg', '.jpeg'] },
  'image/webp': { extension: '.webp', acceptedExtensions: ['.webp'] },
  'image/gif': { extension: '.gif', acceptedExtensions: ['.gif'] },
  'image/svg+xml': { extension: '.svg', acceptedExtensions: ['.svg'] },
  'video/mp4': { extension: '.mp4', acceptedExtensions: ['.mp4', '.m4v'] },
  'video/webm': { extension: '.webm', acceptedExtensions: ['.webm'] },
  'video/quicktime': { extension: '.mov', acceptedExtensions: ['.mov'] },
} as const;

function isPathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

/**
 * Produces a filename only. Its directory is always chosen by trusted
 * main-process code (the native save dialog or the managed library view),
 * never accepted from renderer IPC.
 */
export function safeAssetFileName(value: string, fallback: string, extension: string) {
  const currentExtension = path.extname(value);
  const rawStem = path.basename(value, currentExtension).normalize('NFKC');
  const clean = trimTrailingCharacters(
    rawStem.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' '),
    '. ',
  ).trim();
  const fallbackStem =
    fallback
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || 'image';
  const bounded = Array.from(clean).slice(0, 120).join('');
  const stem = bounded && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(bounded) ? bounded : fallbackStem;
  return `${stem}${extension}`;
}

export function acceptedAssetExportExtensions(mimeType: ResolvedAssetFile['mimeType']) {
  return [...imageFileTypes[mimeType].acceptedExtensions];
}

function hasExpectedMediaSignature(filePath: string, mimeType: ResolvedAssetFile['mimeType']) {
  const descriptor = openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(mimeType === 'image/svg+xml' ? Math.min(statSync(filePath).size, 4 * 1024 * 1024) : 12);
    const length = readSync(descriptor, header, 0, header.length, 0);
    return hasExpectedMediaHeader(header.subarray(0, length), mimeType);
  } finally {
    closeSync(descriptor);
  }
}

function hasExpectedMediaHeader(header: Buffer, mimeType: ResolvedAssetFile['mimeType']) {
  if (mimeType === 'image/png') {
    return header.length >= 8 && header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  if (mimeType === 'image/jpeg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    const signature = header.subarray(0, 6).toString('ascii');
    return header.length >= 10 && (signature === 'GIF87a' || signature === 'GIF89a');
  }
  if (mimeType === 'image/svg+xml') {
    return imageDimensions(header, '.svg') !== null;
  }
  if (mimeType === 'video/webm') {
    return header.length >= 4 && header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
  }
  if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
    return header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  return (
    header.length >= 12 &&
    header.subarray(0, 4).toString('ascii') === 'RIFF' &&
    header.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

export class AssetFileRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  private rows(assetIds: readonly string[]) {
    return this.db
      .prepare(
        `SELECT asset.id, asset.object_hash, asset.relative_path, asset.mime_type,
        asset.width, asset.height, asset.byte_size,
        COALESCE(
          (
            SELECT NULLIF(TRIM(metadata.display_name), '')
            FROM materials material
            JOIN external_material_metadata metadata ON metadata.material_id = material.id
            WHERE material.image_asset_id = asset.id
              AND material.kind IN ('IMAGE', 'VIDEO') AND material.deleted_at IS NULL
            ORDER BY metadata.updated_at DESC, metadata.material_id DESC
            LIMIT 1
          ),
          (
            SELECT NULLIF(TRIM(imported.display_name), '')
            FROM creation_output_imports imported
            WHERE imported.image_asset_id = asset.id AND imported.deleted_at IS NULL
            ORDER BY imported.created_at DESC, imported.id DESC
            LIMIT 1
          ),
          (
            SELECT NULLIF(TRIM(imported.original_name), '')
            FROM creation_output_imports imported
            WHERE imported.image_asset_id = asset.id AND imported.deleted_at IS NULL
            ORDER BY imported.created_at DESC, imported.id DESC
            LIMIT 1
          ),
          (
            SELECT COALESCE(
              NULLIF(TRIM(series.title), ''),
              'Creation'
            )
            FROM generation_runs run
            JOIN prompt_versions version ON version.id = run.prompt_version_id
            JOIN prompt_series series ON series.id = version.series_id
            WHERE run.result_asset_id = asset.id AND run.status = 'SUCCEEDED'
            ORDER BY COALESCE(run.finished_at, run.created_at) DESC, run.id DESC
            LIMIT 1
          ),
          asset.id
        ) AS display_name
      FROM image_assets asset
      WHERE asset.id IN (SELECT value FROM json_each(?)) AND asset.deleted_at IS NULL`,
      )
      .all(JSON.stringify(assetIds)) as JsonMap[];
  }

  resolve(assetId: string): ResolvedAssetFile | null {
    const row = this.rows([assetId])[0];
    if (!row) return null;

    const mimeType = text(row.mime_type) as keyof typeof imageFileTypes;
    const fileType = imageFileTypes[mimeType];
    if (!fileType) return null;

    const relativePath = text(row.relative_path);
    if (!relativePath || path.isAbsolute(relativePath)) return null;

    try {
      const root = realpathSync(this.storage.libraryRoot);
      const candidate = path.resolve(root, relativePath);
      if (!isPathInside(root, candidate)) return null;
      const absolutePath = realpathSync(candidate);
      if (!isPathInside(root, absolutePath) || !statSync(absolutePath).isFile()) return null;
      const actualExtension = path.extname(absolutePath).toLowerCase();
      if (!fileType.acceptedExtensions.includes(actualExtension as never)) return null;
      if (!hasExpectedMediaSignature(absolutePath, mimeType)) return null;
      return {
        assetId: text(row.id),
        objectHash: text(row.object_hash),
        absolutePath,
        suggestedName: safeAssetFileName(text(row.display_name), `image-${assetId}`, fileType.extension),
        extension: fileType.extension,
        mimeType,
        width: Number(row.width),
        height: Number(row.height),
        byteSize: Number(row.byte_size),
      };
    } catch {
      return null;
    }
  }

  async resolveManyAsync(assetIds: readonly string[]): Promise<ReadonlyMap<string, ResolvedAssetFile>> {
    if (!assetIds.length) return new Map();
    const rows = this.rows([...new Set(assetIds)]);
    const files = new Map<string, ResolvedAssetFile>();
    const root = await realpath(this.storage.libraryRoot);
    // A single metadata query; file checks are sequential and only read bounded headers.
    for (const row of rows) {
      const mimeType = text(row.mime_type) as keyof typeof imageFileTypes;
      const fileType = imageFileTypes[mimeType];
      const relativePath = text(row.relative_path);
      if (!fileType || !relativePath || path.isAbsolute(relativePath)) continue;
      try {
        const candidate = path.resolve(root, relativePath);
        if (!isPathInside(root, candidate)) continue;
        const absolutePath = await realpath(candidate);
        if (!isPathInside(root, absolutePath)) continue;
        const info = await stat(absolutePath);
        if (
          !info.isFile() ||
          !fileType.acceptedExtensions.includes(path.extname(absolutePath).toLowerCase() as never)
        ) {
          continue;
        }
        const handle = await open(absolutePath, 'r');
        try {
          const header = Buffer.alloc(mimeType === 'image/svg+xml' ? Math.min(info.size, 4 * 1024 * 1024) : 12);
          const { bytesRead } = await handle.read(header, 0, header.length, 0);
          if (!hasExpectedMediaHeader(header.subarray(0, bytesRead), mimeType)) continue;
        } finally {
          await handle.close();
        }
        const assetId = text(row.id);
        files.set(assetId, {
          assetId,
          objectHash: text(row.object_hash),
          absolutePath,
          suggestedName: safeAssetFileName(text(row.display_name), assetId, fileType.extension),
          extension: fileType.extension,
          mimeType,
          width: Number(row.width),
          height: Number(row.height),
          byteSize: Number(row.byte_size),
        });
      } catch {
        // An unavailable file is reported by the caller with its article reference.
      }
    }
    return files;
  }
}
