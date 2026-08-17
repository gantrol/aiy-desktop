import { ulid } from 'ulid';
import type {
  AssetDto,
  DeletePromptSeriesInput,
  DeletePromptSeriesResult,
  GenerationErrorDetailsDto,
  GenerationInput,
  GenerationQuality,
  GenerationVersionInput,
  RenamePromptSeriesInput,
} from '@/shared/contracts';
import { ensureImageMaterials } from '@/main/database/albums/image-material-batch';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { archiveIdeasForSeries } from '@/main/database/creations/idea-creation-lifecycle';
import { WorkbenchPreparationRepository } from '@/main/database/generation/workbench-preparation-repository';
import { jsonStringRecord, nullableDimension } from '@/main/database/generation/workbench-values';
import {
  resolveStoredTitle,
  titleLocalizationsByOwner,
  writeLocalizedTitle,
} from '@/main/database/core/title-localization';

export class WorkbenchRunRepository extends WorkbenchPreparationRepository {
  prepareGenerationRetry(sourceRunId: string) {
    return this.db.transaction(() => {
      const source = this.db
        .prepare(
          `SELECT run.*, version.series_id, version.user_intent,
            version.final_prompt, version.change_summary, version.composition_mode, version.term_prompt_locale,
            version.source_image_id,
            series.title, series.title_locale
          FROM generation_runs run
          JOIN prompt_versions version ON version.id = run.prompt_version_id
          JOIN prompt_series series ON series.id = version.series_id
          WHERE run.id = ? AND series.deleted_at IS NULL`,
        )
        .get(sourceRunId) as JsonMap | undefined;
      if (!source) throw new Error('Generation run not found');
      if (!['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(text(source.status))) {
        throw new Error('Only failed, cancelled, or interrupted generations can be retried');
      }

      const versionId = text(source.prompt_version_id);
      const seriesId = text(source.series_id);
      const effectiveReferenceAssetIds = (
        this.db
          .prepare(
            `SELECT image_asset_id
          FROM reference_bindings WHERE prompt_version_id = ?
          GROUP BY image_asset_id ORDER BY MIN(sort_order), MIN(rowid)`,
          )
          .all(versionId) as JsonMap[]
      ).map((row) => text(row.image_asset_id));
      const termIds = (
        this.db
          .prepare(
            `SELECT term_id FROM prompt_term_bindings
          WHERE prompt_version_id = ? ORDER BY sort_order, rowid`,
          )
          .all(versionId) as JsonMap[]
      ).map((row) => text(row.term_id));
      const wordPaletteReferences = (
        this.db
          .prepare(
            `SELECT binding.palette_id,
            COALESCE(binding.palette_revision_id, palette.current_revision_id) AS palette_revision_id,
            binding.parameter_values_json, binding.prompt_locale
          FROM prompt_palette_bindings binding
          JOIN word_palettes palette ON palette.id = binding.palette_id
          WHERE binding.prompt_version_id = ? ORDER BY binding.sort_order, binding.rowid`,
          )
          .all(versionId) as JsonMap[]
      ).map((row) => ({
        paletteId: text(row.palette_id),
        paletteRevisionId: text(row.palette_revision_id),
        parameterValues: jsonStringRecord(row.parameter_values_json),
        promptLocale: text(row.prompt_locale) === 'zh' ? ('zh' as const) : ('en' as const),
      }));

      const runId = ulid();
      const submittedAt = now();
      this.db
        .prepare(
          `INSERT INTO generation_runs
          (id, prompt_version_id, model_key, canvas_preset_key, width, height, quality, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)`,
        )
        .run(
          runId,
          versionId,
          text(source.model_key),
          source.canvas_preset_key ?? null,
          Number(source.width),
          Number(source.height),
          text(source.quality),
          submittedAt,
        );
      this.generationJobs.createForRun(runId, sourceRunId);
      this.storage.recordChange('GENERATION_RUN', runId, 'RETRY', { sourceRunId, seriesId, versionId });

      const manualPrompt =
        text(source.composition_mode) === 'STRUCTURED' ? text(source.user_intent) : text(source.final_prompt);
      const title = text(source.title);
      return {
        runId,
        versionId,
        seriesId,
        effectiveReferenceAssetIds,
        input: {
          seriesId,
          sourceAssetId: source.source_image_id ? text(source.source_image_id) : null,
          title: title,
          titleLocale: text(source.title_locale) === 'en' ? 'en' : 'zh',
          manualPrompt,
          prompt: text(source.final_prompt),
          changeSummary: text(source.change_summary),
          referenceAssetIds: effectiveReferenceAssetIds,
          termPromptLocale: text(source.term_prompt_locale) === 'zh' ? ('zh' as const) : ('en' as const),
          termIds,
          wordPaletteReferences,
          modelKey: text(source.model_key),
          canvasPresetKey: source.canvas_preset_key ? text(source.canvas_preset_key) : null,
          width: nullableDimension(source.width),
          height: nullableDimension(source.height),
          quality: text(source.quality) as GenerationQuality,
        } satisfies GenerationInput,
      };
    })();
  }

  prepareGenerationFromVersion(
    versionId: string,
    modelKey: string,
    settings?: Omit<GenerationVersionInput, 'versionId' | 'modelKey'>,
  ) {
    return this.db.transaction(() => {
      const source = this.db
        .prepare(
          `SELECT version.*, series.title, series.title_locale,
            latest.canvas_preset_key, latest.width, latest.height, latest.quality
          FROM prompt_versions version
          JOIN prompt_series series ON series.id = version.series_id
          LEFT JOIN generation_runs latest ON latest.id = (
            SELECT candidate.id FROM generation_runs candidate
            WHERE candidate.prompt_version_id = version.id
            ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
          )
          WHERE version.id = ? AND series.deleted_at IS NULL`,
        )
        .get(versionId) as JsonMap | undefined;
      if (!source) throw new Error('Prompt version not found');

      const seriesId = text(source.series_id);
      const effectiveReferenceAssetIds = (
        this.db
          .prepare(
            `SELECT image_asset_id
          FROM reference_bindings WHERE prompt_version_id = ?
          GROUP BY image_asset_id ORDER BY MIN(sort_order), MIN(rowid)`,
          )
          .all(versionId) as JsonMap[]
      ).map((row) => text(row.image_asset_id));
      const termIds = (
        this.db
          .prepare(
            `SELECT term_id FROM prompt_term_bindings
          WHERE prompt_version_id = ? ORDER BY sort_order, rowid`,
          )
          .all(versionId) as JsonMap[]
      ).map((row) => text(row.term_id));
      const wordPaletteReferences = (
        this.db
          .prepare(
            `SELECT binding.palette_id,
            COALESCE(binding.palette_revision_id, palette.current_revision_id) AS palette_revision_id,
            binding.parameter_values_json, binding.prompt_locale
          FROM prompt_palette_bindings binding
          JOIN word_palettes palette ON palette.id = binding.palette_id
          WHERE binding.prompt_version_id = ? ORDER BY binding.sort_order, binding.rowid`,
          )
          .all(versionId) as JsonMap[]
      ).map((row) => ({
        paletteId: text(row.palette_id),
        paletteRevisionId: text(row.palette_revision_id),
        parameterValues: jsonStringRecord(row.parameter_values_json),
        promptLocale: text(row.prompt_locale) === 'zh' ? ('zh' as const) : ('en' as const),
      }));

      const runId = ulid();
      const submittedAt = now();
      const canvasPresetKey = settings
        ? settings.canvasPresetKey
        : source.canvas_preset_key
          ? text(source.canvas_preset_key)
          : null;
      const width = settings ? settings.width : nullableDimension(source.width);
      const height = settings ? settings.height : nullableDimension(source.height);
      const quality = settings
        ? settings.quality
        : ['low', 'medium', 'high'].includes(text(source.quality))
          ? (text(source.quality) as GenerationQuality)
          : 'low';
      this.db
        .prepare(
          `INSERT INTO generation_runs
          (id, prompt_version_id, model_key, canvas_preset_key, width, height, quality, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)`,
        )
        .run(runId, versionId, modelKey, canvasPresetKey, width ?? 0, height ?? 0, quality, submittedAt);
      this.generationJobs.createForRun(runId);
      this.storage.recordChange('GENERATION_RUN', runId, 'CREATE_FROM_VERSION', { seriesId, versionId, modelKey });

      const manualPrompt =
        text(source.composition_mode) === 'STRUCTURED' ? text(source.user_intent) : text(source.final_prompt);
      const title = text(source.title);
      return {
        runId,
        versionId,
        seriesId,
        effectiveReferenceAssetIds,
        input: {
          seriesId,
          sourceAssetId: source.source_image_id ? text(source.source_image_id) : null,
          title: title,
          titleLocale: text(source.title_locale) === 'en' ? 'en' : 'zh',
          manualPrompt,
          prompt: text(source.final_prompt),
          changeSummary: text(source.change_summary),
          referenceAssetIds: effectiveReferenceAssetIds,
          termPromptLocale: text(source.term_prompt_locale) === 'zh' ? ('zh' as const) : ('en' as const),
          termIds,
          wordPaletteReferences,
          modelKey,
          canvasPresetKey,
          width,
          height,
          quality,
        } satisfies GenerationInput,
      };
    })();
  }

  renameSeries(input: RenamePromptSeriesInput) {
    return this.db.transaction(() => {
      const locale = input.locale ?? 'zh';
      const row = this.db
        .prepare('SELECT title, title_locale FROM prompt_series WHERE id = ? AND deleted_at IS NULL')
        .get(input.seriesId) as JsonMap | undefined;
      if (!row) throw new Error('Prompt series not found');
      const currentTitle = resolveStoredTitle(
        row,
        locale,
        titleLocalizationsByOwner(this.db, 'PROMPT_SERIES', [input.seriesId]).get(input.seriesId) ?? [],
      );
      if (input.expectedTitle !== undefined && currentTitle !== input.expectedTitle.trim()) {
        return { renamed: false };
      }
      const title = input.title.trim() || currentTitle || '新创作';
      writeLocalizedTitle(this.db, 'PROMPT_SERIES', input.seriesId, locale, title);
      this.storage.recordChange('PROMPT_SERIES', input.seriesId, 'RENAME', { title, locale });
      return { renamed: true };
    })();
  }

  deleteSeries(input: DeletePromptSeriesInput): DeletePromptSeriesResult {
    return this.db.transaction(() => {
      const { seriesId, outputDisposition } = input;
      const existing = this.db
        .prepare('SELECT id FROM prompt_series WHERE id = ? AND deleted_at IS NULL')
        .get(seriesId) as JsonMap | undefined;
      if (!existing) throw new Error('Prompt series not found');
      const activeRun = this.db
        .prepare(
          `SELECT 1 FROM generation_runs gr
          JOIN prompt_versions pv ON pv.id = gr.prompt_version_id
          WHERE pv.series_id = ? AND gr.status IN ('QUEUED', 'RUNNING') LIMIT 1`,
        )
        .get(seriesId);
      if (activeRun) throw new Error('Cannot delete a prompt series while it is generating');
      const deletedAt = now();
      const importedOutputRows = this.db
        .prepare(
          `SELECT id, image_asset_id FROM creation_output_imports
          WHERE series_id = ? AND deleted_at IS NULL`,
        )
        .all(seriesId) as JsonMap[];
      const transformedOutputRows = this.db
        .prepare(
          `SELECT id, output_asset_id FROM image_transform_runs
          WHERE series_id = ? AND deleted_at IS NULL`,
        )
        .all(seriesId) as JsonMap[];
      const associatedOutputAssetIds = (
        this.db
          .prepare(
            `SELECT DISTINCT associated.id FROM (
            SELECT gr.result_asset_id AS id FROM generation_runs gr
            JOIN prompt_versions pv ON pv.id = gr.prompt_version_id
            WHERE pv.series_id = ? AND gr.result_asset_id IS NOT NULL
            UNION
            SELECT imported.image_asset_id AS id FROM creation_output_imports imported
            WHERE imported.series_id = ? AND imported.deleted_at IS NULL
            UNION
            SELECT transform.output_asset_id AS id FROM image_transform_runs transform
            WHERE transform.series_id = ? AND transform.deleted_at IS NULL
          ) associated
          JOIN image_assets asset ON asset.id = associated.id
          WHERE asset.deleted_at IS NULL`,
          )
          .all(seriesId, seriesId, seriesId) as JsonMap[]
      ).map((row) => text(row.id));
      if (outputDisposition === 'KEEP') ensureImageMaterials(this.storage, associatedOutputAssetIds);
      const imageAssetIds =
        outputDisposition === 'TRASH'
          ? (
              this.db
                .prepare(
                  `WITH associated(id) AS (
                  SELECT gr.result_asset_id FROM generation_runs gr
                  JOIN prompt_versions pv ON pv.id = gr.prompt_version_id
                  WHERE pv.series_id = ? AND gr.result_asset_id IS NOT NULL
                  UNION
                  SELECT imported.image_asset_id FROM creation_output_imports imported
                  WHERE imported.series_id = ? AND imported.deleted_at IS NULL
                  UNION
                  SELECT transform.output_asset_id FROM image_transform_runs transform
                  WHERE transform.series_id = ? AND transform.deleted_at IS NULL
                )
                SELECT DISTINCT asset.id
                FROM associated
                JOIN image_assets asset ON asset.id = associated.id AND asset.deleted_at IS NULL
                WHERE NOT EXISTS (
                  SELECT 1 FROM generation_runs other_run
                  JOIN prompt_versions other_version ON other_version.id = other_run.prompt_version_id
                  JOIN prompt_series other_series ON other_series.id = other_version.series_id
                    AND other_series.deleted_at IS NULL
                  WHERE other_series.id <> ? AND other_run.result_asset_id = asset.id
                ) AND NOT EXISTS (
                  SELECT 1 FROM creation_output_imports other_import
                  JOIN prompt_series other_series ON other_series.id = other_import.series_id
                    AND other_series.deleted_at IS NULL
                  WHERE other_series.id <> ? AND other_import.image_asset_id = asset.id
                    AND other_import.deleted_at IS NULL
                ) AND NOT EXISTS (
                  SELECT 1 FROM image_transform_runs other_transform
                  JOIN prompt_series other_series ON other_series.id = other_transform.series_id
                    AND other_series.deleted_at IS NULL
                  WHERE other_series.id <> ? AND other_transform.output_asset_id = asset.id
                    AND other_transform.deleted_at IS NULL
                ) AND NOT EXISTS (
                  SELECT 1 FROM reference_bindings binding
                  JOIN prompt_versions version ON version.id = binding.prompt_version_id
                  JOIN prompt_series other_series ON other_series.id = version.series_id
                    AND other_series.deleted_at IS NULL
                  WHERE other_series.id <> ? AND binding.image_asset_id = asset.id
                ) AND NOT EXISTS (
                  SELECT 1 FROM prompt_versions source_version
                  JOIN prompt_series other_series ON other_series.id = source_version.series_id
                    AND other_series.deleted_at IS NULL
                  WHERE other_series.id <> ? AND source_version.source_image_id = asset.id
                ) AND NOT EXISTS (
                  SELECT 1 FROM materials material
                  JOIN album_members member ON member.target_type = 'MATERIAL'
                    AND member.target_id = material.id AND member.deleted_at IS NULL
                  JOIN albums owner ON owner.id = member.album_id AND owner.deleted_at IS NULL
                  WHERE material.kind IN ('IMAGE', 'VIDEO') AND material.image_asset_id = asset.id
                    AND material.deleted_at IS NULL
                ) AND NOT EXISTS (
                  SELECT 1 FROM materials material
                  JOIN material_favorites favorite ON favorite.material_id = material.id
                    AND favorite.deleted_at IS NULL
                  WHERE material.kind IN ('IMAGE', 'VIDEO') AND material.image_asset_id = asset.id
                    AND material.deleted_at IS NULL
                ) AND NOT EXISTS (
                  SELECT 1 FROM term_media_links media
                  WHERE media.image_asset_id = asset.id AND media.deleted_at IS NULL
                ) AND NOT EXISTS (
                  SELECT 1 FROM term_evidence evidence WHERE evidence.image_asset_id = asset.id
                ) AND NOT EXISTS (
                  SELECT 1 FROM asset_derivations derivation
                  JOIN image_assets child ON child.id = derivation.child_asset_id AND child.deleted_at IS NULL
                  WHERE derivation.source_asset_id = asset.id
                )`,
                )
                .all(seriesId, seriesId, seriesId, seriesId, seriesId, seriesId, seriesId, seriesId) as JsonMap[]
            ).map((row) => text(row.id))
          : [];
      this.db.prepare('UPDATE prompt_series SET deleted_at = ? WHERE id = ?').run(deletedAt, seriesId);
      archiveIdeasForSeries(this.storage, seriesId, deletedAt);
      this.db
        .prepare(
          `UPDATE creation_output_imports SET deleted_at = ?
          WHERE series_id = ? AND deleted_at IS NULL`,
        )
        .run(deletedAt, seriesId);
      this.db
        .prepare(
          `UPDATE image_transform_runs SET deleted_at = ?
          WHERE series_id = ? AND deleted_at IS NULL`,
        )
        .run(deletedAt, seriesId);
      for (const output of importedOutputRows) {
        this.db
          .prepare("INSERT INTO tombstones VALUES (?, 'CREATION_OUTPUT_IMPORT', ?, ?, 'LOCAL_ONLY')")
          .run(ulid(), output.id, deletedAt);
        this.storage.recordChange('CREATION_OUTPUT_IMPORT', text(output.id), 'DELETE', { seriesId });
      }
      for (const output of transformedOutputRows) {
        this.db
          .prepare("INSERT INTO tombstones VALUES (?, 'IMAGE_TRANSFORM', ?, ?, 'LOCAL_ONLY')")
          .run(ulid(), output.id, deletedAt);
        this.storage.recordChange('IMAGE_TRANSFORM', text(output.id), 'DELETE', { seriesId });
      }
      for (const imageAssetId of imageAssetIds) {
        this.db.prepare('UPDATE image_assets SET deleted_at = ? WHERE id = ?').run(deletedAt, imageAssetId);
        this.db
          .prepare("INSERT INTO tombstones VALUES (?, 'IMAGE_ASSET', ?, ?, 'LOCAL_ONLY')")
          .run(ulid(), imageAssetId, deletedAt);
        this.storage.recordChange('IMAGE_ASSET', imageAssetId, 'DELETE', { sourceSeriesId: seriesId });
      }
      this.db
        .prepare("INSERT INTO tombstones VALUES (?, 'PROMPT_SERIES', ?, ?, 'LOCAL_ONLY')")
        .run(ulid(), seriesId, deletedAt);
      this.storage.recordChange('PROMPT_SERIES', seriesId, 'DELETE', { outputDisposition, imageAssetIds });
      return {
        seriesId,
        outputDisposition,
        trashedOutputCount: imageAssetIds.length,
        retainedOutputCount: outputDisposition === 'TRASH' ? associatedOutputAssetIds.length - imageAssetIds.length : 0,
      };
    })();
  }

  markRun(
    runId: string,
    status: string,
    errorMessage?: string,
    errorCode?: string,
    errorDetails?: GenerationErrorDetailsDto,
  ) {
    return this.generationJobs.markStatus(runId, status, errorMessage, errorCode, errorDetails);
  }

  setGenerationOutputFailed(runId: string, failed: boolean) {
    return this.db.transaction(() => {
      const run = this.db
        .prepare(
          `SELECT run.id, run.result_asset_id, review.id AS review_id,
            review.disposition
          FROM generation_runs run
          LEFT JOIN generation_output_reviews review ON review.generation_run_id = run.id
          WHERE run.id = ?`,
        )
        .get(runId) as JsonMap | undefined;
      if (!run || !run.result_asset_id) throw new Error('Generation output is unavailable');
      const disposition = failed ? 'FAILED' : 'VISIBLE';
      if (text(run.disposition) === disposition) return;
      const timestamp = now();
      const reviewId = run.review_id ? text(run.review_id) : ulid();
      this.db
        .prepare(
          `INSERT INTO generation_output_reviews
            (id, generation_run_id, disposition, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(generation_run_id) DO UPDATE SET
            disposition = excluded.disposition,
            updated_at = excluded.updated_at`,
        )
        .run(reviewId, runId, disposition, timestamp, timestamp);
      this.storage.recordChange('GENERATION_OUTPUT_REVIEW', reviewId, failed ? 'MARK_FAILED' : 'RESTORE', {
        runId,
        assetId: text(run.result_asset_id),
        disposition,
      });
    })();
  }

  listGenerationRunIdsForTempCleanup(): string[] {
    return (
      this.db
        .prepare(
          `SELECT id FROM generation_runs
        WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
        ORDER BY id`,
        )
        .all() as Array<{ id: string }>
    ).map(({ id }) => id);
  }

  getGenerationRunModelKey(runId: string) {
    const row = this.db.prepare('SELECT model_key FROM generation_runs WHERE id = ?').get(runId) as
      { model_key: string } | undefined;
    return row?.model_key ?? null;
  }

  finishGeneration(runId: string, outputPath: string, sourceAssetId: string | null = null): AssetDto {
    if (sourceAssetId && !this.getAssetPath(sourceAssetId)) {
      throw new Error('Image edit source is unavailable');
    }
    const committedAssetId = this.generationJobs.outputAssetId(runId);
    if (committedAssetId) {
      if (sourceAssetId) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO asset_derivations
            (id, child_asset_id, source_asset_id, relation_type, generation_run_id, created_at)
            VALUES (?, ?, ?, 'IMAGE_EDIT', ?, ?)`,
          )
          .run(ulid(), committedAssetId, sourceAssetId, runId, now());
      }
      this.db.transaction(() => ensureImageMaterials(this.storage, [committedAssetId])).immediate();
      const committed = this.assetDto(committedAssetId);
      if (!committed) throw new Error('Committed generation output is unavailable');
      return committed;
    }
    const imported = this.storage.copyIntoObjectStore(outputPath);
    const assetId = ulid();
    const resolvedAssetId = this.db.transaction(() => {
      const concurrentAssetId = this.generationJobs.outputAssetId(runId);
      if (concurrentAssetId) return concurrentAssetId;
      this.db
        .prepare(
          `INSERT INTO image_assets
          (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
          VALUES (?, 'GENERATED', 'GENERATION', ?, ?, ?, ?, 'image/png', ?, ?, NULL)`,
        )
        .run(assetId, imported.hash, imported.relativePath, imported.width, imported.height, imported.byteSize, now());
      if (sourceAssetId) {
        this.db
          .prepare(
            `INSERT INTO asset_derivations
            (id, child_asset_id, source_asset_id, relation_type, generation_run_id, created_at)
            VALUES (?, ?, ?, 'IMAGE_EDIT', ?, ?)`,
          )
          .run(ulid(), assetId, sourceAssetId, runId, now());
      }
      this.generationJobs.markOutputSucceeded(runId, assetId);
      ensureImageMaterials(this.storage, [assetId]);
      this.storage.recordChange('GENERATION_RUN', runId, 'SUCCEED', { assetId, sourceAssetId });
      return assetId;
    })();
    const output = this.assetDto(resolvedAssetId);
    if (!output) throw new Error('Committed generation output is unavailable');
    return output;
  }

  finishGenerationFromAsset(runId: string, sourceAssetId: string, relationType: 'MODEL_REPLAY'): AssetDto {
    const committedAssetId = this.generationJobs.outputAssetId(runId);
    if (committedAssetId) {
      this.db.transaction(() => ensureImageMaterials(this.storage, [committedAssetId])).immediate();
      const committed = this.assetDto(committedAssetId);
      if (!committed) throw new Error('Committed generation output is unavailable');
      return committed;
    }
    const source = this.db
      .prepare(
        `SELECT asset.* FROM image_assets asset
        WHERE asset.id = ? AND asset.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM asset_derivations derivation
            WHERE derivation.child_asset_id = asset.id AND derivation.relation_type = 'MODEL_REPLAY'
          )`,
      )
      .get(sourceAssetId) as JsonMap | undefined;
    if (!source || !this.getAssetPath(sourceAssetId)) throw new Error('Generation source asset is unavailable');

    const assetId = ulid();
    const createdAt = now();
    const resolvedAssetId = this.db.transaction(() => {
      const concurrentAssetId = this.generationJobs.outputAssetId(runId);
      if (concurrentAssetId) return concurrentAssetId;
      this.db
        .prepare(
          `INSERT INTO image_assets
          (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
          VALUES (?, 'GENERATED', 'GENERATION', ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          assetId,
          text(source.object_hash),
          text(source.relative_path),
          Number(source.width),
          Number(source.height),
          text(source.mime_type),
          Number(source.byte_size),
          createdAt,
        );
      this.db
        .prepare(
          `INSERT INTO asset_derivations
          (id, child_asset_id, source_asset_id, relation_type, generation_run_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(ulid(), assetId, sourceAssetId, relationType, runId, createdAt);
      this.generationJobs.markOutputSucceeded(runId, assetId);
      ensureImageMaterials(this.storage, [assetId]);
      this.storage.recordChange('GENERATION_RUN', runId, 'SUCCEED', { assetId, sourceAssetId, relationType });
      return assetId;
    })();
    const output = this.assetDto(resolvedAssetId);
    if (!output) throw new Error('Committed generation output is unavailable');
    return output;
  }
}
