import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
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
    if (mimeType === 'image/png') {
      return length >= 8 && header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    }
    if (mimeType === 'image/jpeg') {
      return length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    }
    if (mimeType === 'image/gif') {
      const signature = header.subarray(0, 6).toString('ascii');
      return length >= 10 && (signature === 'GIF87a' || signature === 'GIF89a');
    }
    if (mimeType === 'image/svg+xml') {
      return imageDimensions(header.subarray(0, length), '.svg') !== null;
    }
    if (mimeType === 'video/webm') {
      return length >= 4 && header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
    }
    if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
      return length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp';
    }
    return (
      length >= 12 &&
      header.subarray(0, 4).toString('ascii') === 'RIFF' &&
      header.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  } finally {
    closeSync(descriptor);
  }
}

export class AssetFileRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  resolve(assetId: string): ResolvedAssetFile | null {
    const row = this.db
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
      WHERE asset.id = ? AND asset.deleted_at IS NULL`,
      )
      .get(assetId) as JsonMap | undefined;
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
}
