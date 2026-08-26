import {
  MAX_PROMPT_SERIES_COVERS,
  type PromptSeriesCoverSetInput,
  type PromptSeriesOutputPresentationResult,
  type PromptSeriesOutputRemoveInput,
} from '@/shared/contracts/creation-output-presentation';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import {
  creationItemIncludesSeries,
  creationOutputNotExcluded,
} from '@/main/database/creations/creation-output-presentation-sql';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';

export class CreationOutputPresentationRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  remove(input: PromptSeriesOutputRemoveInput): PromptSeriesOutputPresentationResult {
    return this.db
      .transaction(() => {
        this.series(input.seriesId);
        if (!this.outputExists(input.seriesId, input.imageAssetId, true)) {
          throw new Error('Creation output not found');
        }
        const removedAt = now();
        const inserted = this.db
          .prepare(
            `INSERT INTO prompt_series_output_exclusions(series_id, image_asset_id, removed_at)
            VALUES (?, ?, ?)
            ON CONFLICT(series_id, image_asset_id) DO NOTHING`,
          )
          .run(input.seriesId, input.imageAssetId, removedAt);
        const updatedCoverSeriesIds = inserted.changes
          ? this.coverOwnerIdsForOutput(input.seriesId, input.imageAssetId).filter(
              (coverSeriesId) => !this.coverOutputExists(coverSeriesId, input.imageAssetId),
            )
          : [];
        for (const coverSeriesId of updatedCoverSeriesIds) {
          const previousCoverAssetIds = this.coverAssetIds(coverSeriesId);
          const coverAssetIds = previousCoverAssetIds.filter((assetId) => assetId !== input.imageAssetId);
          this.replaceCoverAssets(coverSeriesId, coverAssetIds, removedAt);
          if (coverSeriesId !== input.seriesId) {
            this.storage.recordChange(
              'PROMPT_SERIES',
              coverSeriesId,
              'SET_COVER',
              {
                seriesId: coverSeriesId,
                previousCoverAssetId: previousCoverAssetIds[0] ?? null,
                coverAssetId: coverAssetIds[0] ?? null,
                previousCoverAssetIds,
                coverAssetIds,
                removedCoverAssetId: input.imageAssetId,
                reason: 'OUTPUT_REMOVED',
              },
              { affectsFileView: false },
            );
          }
        }
        if (inserted.changes) {
          this.storage.recordChange(
            'PROMPT_SERIES',
            input.seriesId,
            'REMOVE_OUTPUT',
            {
              seriesId: input.seriesId,
              imageAssetId: input.imageAssetId,
              updatedCover: updatedCoverSeriesIds.length > 0,
              updatedCoverSeriesIds,
              removedAt,
            },
            { affectsFileView: true },
          );
          const creationItems = new CreationItemRepository(this.storage);
          for (const seriesId of new Set([input.seriesId, ...updatedCoverSeriesIds])) {
            creationItems.touchForSeries(seriesId, removedAt);
          }
        }
        return this.presentationResult(input.seriesId, input.imageAssetId);
      })
      .immediate();
  }

  setCover(input: PromptSeriesCoverSetInput): PromptSeriesOutputPresentationResult {
    return this.db
      .transaction(() => {
        this.series(input.seriesId);
        if (
          input.imageAssetIds.length > MAX_PROMPT_SERIES_COVERS ||
          new Set(input.imageAssetIds).size !== input.imageAssetIds.length
        ) {
          throw new Error(`A creation can have up to ${MAX_PROMPT_SERIES_COVERS} unique covers`);
        }
        for (const imageAssetId of input.imageAssetIds) {
          if (!this.coverOutputExists(input.seriesId, imageAssetId)) {
            throw new Error('Every cover must be a visible output from this creation');
          }
        }
        const previousCoverAssetIds = this.coverAssetIds(input.seriesId);
        if (!this.sameOrderedIds(previousCoverAssetIds, input.imageAssetIds)) {
          const updatedAt = now();
          this.replaceCoverAssets(input.seriesId, input.imageAssetIds, updatedAt);
          this.storage.recordChange(
            'PROMPT_SERIES',
            input.seriesId,
            'SET_COVER',
            {
              seriesId: input.seriesId,
              previousCoverAssetId: previousCoverAssetIds[0] ?? null,
              coverAssetId: input.imageAssetIds[0] ?? null,
              previousCoverAssetIds,
              coverAssetIds: input.imageAssetIds,
            },
            { affectsFileView: false },
          );
          new CreationItemRepository(this.storage).touchForSeries(input.seriesId, updatedAt);
        }
        return this.presentationResult(input.seriesId, input.imageAssetIds[0] ?? null);
      })
      .immediate();
  }

  private series(seriesId: string) {
    const row = this.db.prepare('SELECT id FROM prompt_series WHERE id = ? AND deleted_at IS NULL').get(seriesId) as
      JsonMap | undefined;
    if (!row) throw new Error('Creation not found');
    return row;
  }

  private outputExists(seriesId: string, imageAssetId: string, includeRemoved: boolean) {
    const row = this.db
      .prepare(
        `SELECT 1
        FROM prompt_series series
        JOIN image_assets asset ON asset.id = ? AND asset.deleted_at IS NULL
        WHERE series.id = ? AND series.deleted_at IS NULL
          ${
            includeRemoved
              ? ''
              : `AND NOT EXISTS (
                  SELECT 1 FROM prompt_series_output_exclusions exclusion
                  WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = asset.id
                )`
          }
          AND (
            EXISTS (
              SELECT 1 FROM prompt_versions version
              JOIN generation_runs run ON run.prompt_version_id = version.id
              WHERE version.series_id = series.id AND run.result_asset_id = asset.id
                AND run.status = 'SUCCEEDED'
                AND NOT EXISTS (
                  SELECT 1 FROM generation_output_reviews review
                  WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
                )
            ) OR EXISTS (
              SELECT 1 FROM creation_output_imports imported
              WHERE imported.series_id = series.id AND imported.image_asset_id = asset.id
                AND imported.deleted_at IS NULL
            ) OR EXISTS (
              SELECT 1 FROM image_transform_runs transform
              WHERE transform.series_id = series.id AND transform.output_asset_id = asset.id
                AND transform.deleted_at IS NULL
            )
          )
        LIMIT 1`,
      )
      .get(imageAssetId, seriesId);
    return Boolean(row);
  }

  private coverOutputExists(seriesId: string, imageAssetId: string) {
    const row = this.db
      .prepare(
        `SELECT 1
        FROM prompt_series cover_owner
        JOIN image_assets asset ON asset.id = ? AND asset.deleted_at IS NULL
        JOIN prompt_series output_owner ON output_owner.deleted_at IS NULL
        WHERE cover_owner.id = ? AND cover_owner.deleted_at IS NULL
          AND ${creationItemIncludesSeries('cover_owner.id', 'output_owner.id')}
          AND ${creationOutputNotExcluded('output_owner.id', 'asset.id')}
          AND (
            EXISTS (
              SELECT 1 FROM prompt_versions version
              JOIN generation_runs run ON run.prompt_version_id = version.id
              WHERE version.series_id = output_owner.id AND run.result_asset_id = asset.id
                AND run.status = 'SUCCEEDED'
                AND NOT EXISTS (
                  SELECT 1 FROM generation_output_reviews review
                  WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
                )
            ) OR EXISTS (
              SELECT 1 FROM creation_output_imports imported
              WHERE imported.series_id = output_owner.id AND imported.image_asset_id = asset.id
                AND imported.deleted_at IS NULL
            ) OR EXISTS (
              SELECT 1 FROM image_transform_runs transform
              WHERE transform.series_id = output_owner.id AND transform.output_asset_id = asset.id
                AND transform.deleted_at IS NULL
            )
          )
        LIMIT 1`,
      )
      .get(imageAssetId, seriesId);
    return Boolean(row);
  }

  private coverOwnerIdsForOutput(outputSeriesId: string, imageAssetId: string) {
    const rows = this.db
      .prepare(
        `SELECT cover_owner.id
        FROM prompt_series_cover_assets selected_cover
        JOIN prompt_series cover_owner ON cover_owner.id = selected_cover.series_id
        JOIN prompt_series output_owner ON output_owner.id = ? AND output_owner.deleted_at IS NULL
        WHERE cover_owner.deleted_at IS NULL AND selected_cover.image_asset_id = ?
          AND ${creationItemIncludesSeries('cover_owner.id', 'output_owner.id')}
        ORDER BY cover_owner.id`,
      )
      .all(outputSeriesId, imageAssetId) as JsonMap[];
    return rows.map((row) => text(row.id));
  }

  private coverAssetIds(seriesId: string) {
    const rows = this.db
      .prepare(
        `SELECT image_asset_id FROM prompt_series_cover_assets
        WHERE series_id = ? ORDER BY sort_order, image_asset_id`,
      )
      .all(seriesId) as JsonMap[];
    return rows.map((row) => text(row.image_asset_id));
  }

  private replaceCoverAssets(seriesId: string, imageAssetIds: readonly string[], updatedAt: string) {
    this.db.prepare('DELETE FROM prompt_series_cover_assets WHERE series_id = ?').run(seriesId);
    const insert = this.db.prepare(
      `INSERT INTO prompt_series_cover_assets(series_id, image_asset_id, sort_order, created_at)
      VALUES (?, ?, ?, ?)`,
    );
    imageAssetIds.forEach((imageAssetId, index) => insert.run(seriesId, imageAssetId, index, updatedAt));
    this.db
      .prepare('UPDATE prompt_series SET cover_image_asset_id = ? WHERE id = ?')
      .run(imageAssetIds[0] ?? null, seriesId);
  }

  private sameOrderedIds(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((assetId, index) => assetId === right[index]);
  }

  private presentationResult(seriesId: string, imageAssetId: string | null): PromptSeriesOutputPresentationResult {
    const explicitCoverAssetIds = this.coverAssetIds(seriesId);
    return {
      seriesId,
      imageAssetId,
      explicitCoverAssetId: explicitCoverAssetIds[0] ?? null,
      explicitCoverAssetIds,
    };
  }
}
