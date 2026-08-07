import { ulid } from 'ulid';
import path from 'node:path';
import type { AssetDto, ImageCropInput, ImageTransformOutputDto } from '@/shared/contracts';
import type { LibraryStorage, StoredObject } from '@/main/database/storage';
import { mediaUrl, now, type JsonMap, text } from '@/main/database/values';
import { ensureImageMaterials } from '@/main/database/image-material-batch';

export interface ImageCropStoredCommitInput extends ImageCropInput {
  stored: StoredObject;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export class ImageTransformRepository {
  private readonly db;

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  resolveCropSource(seriesId: string, assetId: string) {
    const source = this.cropSourceRow(seriesId, assetId);
    if (!source) return null;
    const root = path.resolve(this.storage.libraryRoot);
    const sourcePath = path.resolve(root, text(source.relative_path));
    const relative = path.relative(root, sourcePath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return {
      path: sourcePath,
      width: Number(source.width),
      height: Number(source.height),
    };
  }

  createStoredCrop(input: ImageCropStoredCommitInput): ImageTransformOutputDto {
    const stored = input.stored;
    if (stored.width !== input.cropWidth || stored.height !== input.cropHeight) {
      throw new Error('Cropped image dimensions do not match the transform plan');
    }
    return this.db
      .transaction(() => {
        if (!this.sourceBelongsToSeries(input.seriesId, input.sourceAssetId)) {
          throw new Error('The crop source does not belong to this creation');
        }
        const transformId = ulid();
        const assetId = ulid();
        const createdAt = now();
        this.db
          .prepare(
            `INSERT INTO image_assets
        (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
        VALUES (?, 'GENERATED', 'LOCAL_TRANSFORM', ?, ?, ?, ?, 'image/png', ?, ?, NULL)`,
          )
          .run(assetId, stored.hash, stored.relativePath, stored.width, stored.height, stored.byteSize, createdAt);
        this.db
          .prepare(
            `INSERT INTO asset_derivations
        (id, child_asset_id, source_asset_id, relation_type, generation_run_id, created_at)
        VALUES (?, ?, ?, 'LOCAL_CROP', NULL, ?)`,
          )
          .run(ulid(), assetId, input.sourceAssetId, createdAt);
        this.db
          .prepare(
            `INSERT INTO image_transform_runs
        (id, series_id, source_asset_id, output_asset_id, kind, ratio_width, ratio_height,
         crop_x, crop_y, crop_width, crop_height, created_at, deleted_at)
        VALUES (?, ?, ?, ?, 'CROP', ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            transformId,
            input.seriesId,
            input.sourceAssetId,
            assetId,
            input.ratioWidth,
            input.ratioHeight,
            input.cropX,
            input.cropY,
            input.cropWidth,
            input.cropHeight,
            createdAt,
          );
        this.storage.recordChange('IMAGE_TRANSFORM', transformId, 'CREATE', {
          seriesId: input.seriesId,
          sourceAssetId: input.sourceAssetId,
          outputAssetId: assetId,
          kind: 'CROP',
          ratioWidth: input.ratioWidth,
          ratioHeight: input.ratioHeight,
        });
        ensureImageMaterials(this.storage, [assetId]);
        return {
          id: transformId,
          kind: 'CROP' as const,
          seriesId: input.seriesId,
          sourceAssetId: input.sourceAssetId,
          ratioWidth: input.ratioWidth,
          ratioHeight: input.ratioHeight,
          asset: this.assetDto({
            id: assetId,
            kind: 'GENERATED',
            origin_type: 'LOCAL_TRANSFORM',
            width: stored.width,
            height: stored.height,
            mime_type: 'image/png',
            byte_size: stored.byteSize,
            created_at: createdAt,
          }),
          createdAt,
        };
      })
      .immediate();
  }

  listForSeries(seriesId: string): ImageTransformOutputDto[] {
    return (
      this.db
        .prepare(
          `SELECT transform.*, asset.kind AS asset_kind, asset.origin_type,
        asset.width, asset.height, asset.mime_type, asset.byte_size, asset.created_at AS asset_created_at
      FROM image_transform_runs transform
      JOIN image_assets asset ON asset.id = transform.output_asset_id
      WHERE transform.series_id = ? AND transform.deleted_at IS NULL AND asset.deleted_at IS NULL
      ORDER BY transform.created_at DESC, transform.id DESC`,
        )
        .all(seriesId) as JsonMap[]
    ).map((row) => ({
      id: text(row.id),
      kind: 'CROP' as const,
      seriesId: text(row.series_id),
      sourceAssetId: text(row.source_asset_id),
      ratioWidth: Number(row.ratio_width),
      ratioHeight: Number(row.ratio_height),
      asset: this.assetDto({
        id: row.output_asset_id,
        kind: row.asset_kind,
        origin_type: row.origin_type,
        width: row.width,
        height: row.height,
        mime_type: row.mime_type,
        byte_size: row.byte_size,
        created_at: row.asset_created_at,
      }),
      createdAt: text(row.created_at),
    }));
  }

  private sourceBelongsToSeries(seriesId: string, assetId: string) {
    return Boolean(this.cropSourceRow(seriesId, assetId));
  }

  private cropSourceRow(seriesId: string, assetId: string) {
    return this.db
      .prepare(
        `SELECT asset.relative_path, asset.width, asset.height FROM image_assets asset
      WHERE asset.id = ? AND asset.deleted_at IS NULL AND (
        EXISTS (
          SELECT 1 FROM generation_runs run
          JOIN prompt_versions version ON version.id = run.prompt_version_id
          WHERE version.series_id = ? AND run.result_asset_id = asset.id
        ) OR EXISTS (
          SELECT 1 FROM creation_output_imports imported
          WHERE imported.series_id = ? AND imported.image_asset_id = asset.id AND imported.deleted_at IS NULL
        ) OR EXISTS (
          SELECT 1 FROM image_transform_runs transform
          WHERE transform.series_id = ? AND transform.output_asset_id = asset.id AND transform.deleted_at IS NULL
        )
      )`,
      )
      .get(assetId, seriesId, seriesId, seriesId) as JsonMap | undefined;
  }

  private assetDto(row: JsonMap): AssetDto {
    const id = text(row.id);
    return {
      id,
      kind: text(row.kind) === 'REFERENCE' ? 'REFERENCE' : 'GENERATED',
      originType: text(row.origin_type),
      width: Number(row.width),
      height: Number(row.height),
      mimeType: text(row.mime_type),
      byteSize: Number(row.byte_size),
      mediaUrl: mediaUrl(id),
      createdAt: text(row.created_at),
    };
  }
}
