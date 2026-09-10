import type Database from 'better-sqlite3';
import type { ImageTransformOutputDto } from '@/shared/contracts';
import { type JsonMap, text } from '@/main/database/core/values';
import { joinedAssetDto, pushMapped } from '@/main/database/generation/workbench-values';

export function readWorkbenchLocalOutputs(db: Database.Database) {
  const transformedOutputsBySeries = new Map<string, ImageTransformOutputDto[]>();
  const transformRows = db
    .prepare(
      `SELECT transform.*,
          asset.id AS asset_id, asset.kind AS asset_kind, asset.origin_type AS asset_origin_type,
          asset.width AS asset_width, asset.height AS asset_height, asset.mime_type AS asset_mime_type,
          asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at
        FROM image_transform_runs transform
        JOIN prompt_series series ON series.id = transform.series_id
        JOIN image_assets asset ON asset.id = transform.output_asset_id
        WHERE series.deleted_at IS NULL AND transform.deleted_at IS NULL AND asset.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM prompt_series_output_exclusions exclusion
            WHERE exclusion.series_id = transform.series_id AND exclusion.image_asset_id = transform.output_asset_id
          )
        ORDER BY transform.series_id, transform.created_at DESC, transform.id DESC`,
    )
    .all() as JsonMap[];
  for (const row of transformRows) {
    const asset = joinedAssetDto(row);
    if (!asset) continue;
    pushMapped(transformedOutputsBySeries, text(row.series_id), {
      id: text(row.id),
      kind: 'CROP',
      seriesId: text(row.series_id),
      sourceAssetId: text(row.source_asset_id),
      ratioWidth: Number(row.ratio_width),
      ratioHeight: Number(row.ratio_height),
      asset,
      createdAt: text(row.created_at),
    });
  }

  return { transformedOutputsBySeries };
}
