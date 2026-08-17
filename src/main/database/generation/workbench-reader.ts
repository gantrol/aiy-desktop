import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  AssetDto,
  ExecutionInputSnapshotDto,
  GenerationExecutionCommonInputDto,
  GenerationQuality,
  GenerationRunDto,
  GenerationRunPhase,
  ImageGenerationRouteDto,
  ImageGenerationRouteSnapshotDto,
  ImageTransformOutputDto,
  ImportedCreationOutputDto,
  Locale,
  PromptInputSnapshotDto,
  PromptSeriesDto,
  PromptVersionDto,
  ProviderReturnedDescriptionDto,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';
import type { ExecutionSnapshotRepository } from '@/main/database/generation/execution-snapshot-repository';
import type { GenerationJobRepository } from '@/main/database/generation/generation-job-repository';
import { parsePromptCommonInput } from '@/main/database/generation/snapshot-content';
import {
  generationErrorDetails,
  joinedAssetDto,
  jsonStringRecord,
  nullableDimension,
  parsedObject,
  pushMapped,
} from '@/main/database/generation/workbench-values';
import { resolveStoredTitle, titleLocalizationsByOwner } from '@/main/database/core/title-localization';
import { CODEX_APP_SERVER_EXTENSION_ID } from '@/shared/extension-ids';

export class WorkbenchReader {
  private assetPathIndex: Map<string, string> | null = null;
  private assetPathIndexRevision = -1;

  constructor(
    protected readonly storage: LibraryStorage,
    protected readonly executionSnapshots: ExecutionSnapshotRepository,
    protected readonly generationJobs: GenerationJobRepository,
  ) {}

  protected get db() {
    return this.storage.db;
  }

  private storedAssetPath(relativePath: unknown): string | null {
    const full = path.resolve(this.storage.libraryRoot, text(relativePath));
    const root = path.resolve(this.storage.libraryRoot) + path.sep;
    return full.startsWith(root) ? full : null;
  }

  private resolveStoredAssetPath(relativePath: unknown): string | null {
    const full = this.storedAssetPath(relativePath);
    return full && existsSync(full) ? full : null;
  }

  private loadAssetPathIndex() {
    const rows = this.db
      .prepare('SELECT id, relative_path FROM image_assets WHERE deleted_at IS NULL')
      .all() as JsonMap[];
    this.assetPathIndex = new Map(
      rows.flatMap((row) => {
        const full = this.storedAssetPath(row.relative_path);
        return full ? [[text(row.id), full] as const] : [];
      }),
    );
    this.assetPathIndexRevision = this.storage.getImageAssetRevision();
  }

  getWorkbench(
    locale: Locale = 'zh',
    options: { includeExecutionActualRequest?: boolean } = {},
  ): { series: PromptSeriesDto[] } {
    const seriesRows = this.db
      .prepare(
        `SELECT series.*, root_order.sort_order AS root_sort_order
        FROM prompt_series series
        LEFT JOIN sidebar_root_order root_order
          ON root_order.scope = 'CREATOR'
          AND root_order.target_type = 'SERIES' AND root_order.target_id = series.id
        WHERE series.deleted_at IS NULL
        ORDER BY MAX(
          COALESCE((
            SELECT MAX(asset.created_at)
            FROM prompt_versions version
            JOIN generation_runs run ON run.prompt_version_id = version.id
            JOIN image_assets asset ON asset.id = run.result_asset_id
            WHERE version.series_id = series.id AND asset.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM generation_output_reviews review
                WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
              )
          ), ''),
          COALESCE((
            SELECT MAX(imported.created_at)
            FROM creation_output_imports imported
            JOIN image_assets asset ON asset.id = imported.image_asset_id
            WHERE imported.series_id = series.id AND imported.deleted_at IS NULL AND asset.deleted_at IS NULL
          ), ''),
          COALESCE((
            SELECT MAX(transform.created_at)
            FROM image_transform_runs transform
            JOIN image_assets asset ON asset.id = transform.output_asset_id
            WHERE transform.series_id = series.id AND transform.deleted_at IS NULL AND asset.deleted_at IS NULL
          ), ''),
          series.created_at
        ) DESC, series.created_at DESC, series.id DESC`,
      )
      .all() as JsonMap[];
    const titleLocalizations = titleLocalizationsByOwner(
      this.db,
      'PROMPT_SERIES',
      seriesRows.map((row) => text(row.id)),
    );
    const relations = this.readWorkbenchRelations(options);
    const series = seriesRows.map((seriesRow): PromptSeriesDto => {
      const versionRows = relations.versionRowsBySeries.get(text(seriesRow.id)) ?? [];
      const versions = versionRows.map((version) => {
        const isStructured = text(version.composition_mode) === 'STRUCTURED';
        const versionId = text(version.id);
        const runs = relations.runsByVersion.get(versionId) ?? [];
        const termIds = relations.termIdsByVersion.get(versionId) ?? [];
        const wordPaletteReferences = relations.paletteReferencesByVersion.get(versionId) ?? [];
        const referenceAssets = relations.referenceAssetsByVersion.get(versionId) ?? [];
        const promptInputSnapshot = relations.promptInputSnapshotsByVersion.get(versionId) ?? null;
        if (!promptInputSnapshot) throw new Error('Prompt version is missing its immutable input snapshot');
        return {
          id: text(version.id),
          parentVersionId: version.parent_version_id ? text(version.parent_version_id) : null,
          sourceImportId: version.source_import_id ? text(version.source_import_id) : null,
          sourceImageId: version.source_image_id ? text(version.source_image_id) : null,
          versionNo: Number(version.version_no),
          manualPrompt: isStructured ? text(version.user_intent) : text(version.final_prompt),
          finalPrompt: text(version.final_prompt),
          isStructured,
          termPromptLocale: text(version.term_prompt_locale) === 'zh' ? ('zh' as const) : ('en' as const),
          termIds,
          wordPaletteReferences,
          referenceAssets,
          changeSummary: text(version.change_summary),
          createdAt: text(version.created_at),
          runs,
          promptInputSnapshot,
        };
      });
      const seriesId = text(seriesRow.id);
      const importedOutputs = relations.importedOutputsBySeries.get(seriesId) ?? [];
      const transformedOutputs = relations.transformedOutputsBySeries.get(seriesId) ?? [];
      const generatedCover = versions
        .flatMap((item) => item.runs)
        .filter((item) => item.asset && item.outputDisposition !== 'FAILED')
        .sort((left, right) => {
          const byCreatedAt = (right.asset?.createdAt ?? right.createdAt).localeCompare(
            left.asset?.createdAt ?? left.createdAt,
          );
          return byCreatedAt || right.id.localeCompare(left.id);
        })[0];
      const cover =
        [
          ...(generatedCover?.asset
            ? [{ asset: generatedCover.asset, createdAt: generatedCover.asset.createdAt, id: generatedCover.id }]
            : []),
          ...importedOutputs.map((output) => ({ asset: output.asset, createdAt: output.createdAt, id: output.id })),
          ...transformedOutputs.map((output) => ({ asset: output.asset, createdAt: output.createdAt, id: output.id })),
        ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0]
          ?.asset ?? null;
      const title = resolveStoredTitle(seriesRow, locale, titleLocalizations.get(text(seriesRow.id)) ?? []);
      return {
        id: text(seriesRow.id),
        title,
        currentVersionId: seriesRow.current_version_id ? text(seriesRow.current_version_id) : null,
        versions,
        importedOutputs,
        transformedOutputs,
        cover,
        creatorRootSortOrder: seriesRow.root_sort_order == null ? null : Number(seriesRow.root_sort_order),
      };
    });
    return { series };
  }

  private readWorkbenchRelations(options: { includeExecutionActualRequest?: boolean }) {
    const { versionRowsBySeries, promptInputSnapshotsByVersion } = this.readVersionRelations();

    const { runSnapshotsById, providerDescriptionsByRun, derivationByAssetId } = this.readRunMetadataRelations(options);

    const runsByVersion = this.readGenerationRuns({
      runSnapshotsById,
      providerDescriptionsByRun,
      derivationByAssetId,
    });

    const termIdsByVersion = new Map<string, string[]>();
    const termRows = this.db
      .prepare(
        `SELECT binding.prompt_version_id, binding.term_id
        FROM prompt_term_bindings binding
        JOIN prompt_versions version ON version.id = binding.prompt_version_id
        JOIN prompt_series series ON series.id = version.series_id
        WHERE series.deleted_at IS NULL
        ORDER BY binding.prompt_version_id, binding.sort_order, binding.rowid`,
      )
      .all() as JsonMap[];
    for (const row of termRows) pushMapped(termIdsByVersion, text(row.prompt_version_id), text(row.term_id));

    const paletteReferencesByVersion = new Map<string, PromptVersionDto['wordPaletteReferences']>();
    const paletteRows = this.db
      .prepare(
        `SELECT binding.prompt_version_id, binding.palette_id, binding.parameter_values_json,
          binding.prompt_locale, COALESCE(binding.palette_revision_id, palette.current_revision_id) AS palette_revision_id
        FROM prompt_palette_bindings binding
        JOIN word_palettes palette ON palette.id = binding.palette_id
        JOIN prompt_versions version ON version.id = binding.prompt_version_id
        JOIN prompt_series series ON series.id = version.series_id
        WHERE series.deleted_at IS NULL
        ORDER BY binding.prompt_version_id, binding.sort_order, binding.rowid`,
      )
      .all() as JsonMap[];
    for (const row of paletteRows) {
      pushMapped(paletteReferencesByVersion, text(row.prompt_version_id), {
        paletteId: text(row.palette_id),
        paletteRevisionId: text(row.palette_revision_id),
        parameterValues: jsonStringRecord(row.parameter_values_json),
        promptLocale: text(row.prompt_locale) === 'zh' ? 'zh' : 'en',
      });
    }

    const referenceAssetsByVersion = new Map<string, AssetDto[]>();
    const seenReferenceAssetsByVersion = new Map<string, Set<string>>();
    const referenceRows = this.db
      .prepare(
        `SELECT binding.prompt_version_id,
          asset.id AS asset_id, asset.kind AS asset_kind, asset.origin_type AS asset_origin_type,
          asset.width AS asset_width, asset.height AS asset_height, asset.mime_type AS asset_mime_type,
          asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at
        FROM reference_bindings binding
        JOIN prompt_versions version ON version.id = binding.prompt_version_id
        JOIN prompt_series series ON series.id = version.series_id
        JOIN image_assets asset ON asset.id = binding.image_asset_id AND asset.deleted_at IS NULL
        WHERE series.deleted_at IS NULL AND binding.source_type = 'DIRECT'
        ORDER BY binding.prompt_version_id, binding.sort_order, binding.rowid`,
      )
      .all() as JsonMap[];
    for (const row of referenceRows) {
      const versionId = text(row.prompt_version_id);
      const asset = joinedAssetDto(row);
      if (!asset) continue;
      const seen = seenReferenceAssetsByVersion.get(versionId) ?? new Set<string>();
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      seenReferenceAssetsByVersion.set(versionId, seen);
      pushMapped(referenceAssetsByVersion, versionId, asset);
    }

    const importedOutputsBySeries = new Map<string, ImportedCreationOutputDto[]>();
    const importedRows = this.db
      .prepare(
        `SELECT imported.*, asset.kind, asset.origin_type,
          asset.width, asset.height, asset.mime_type, asset.byte_size, asset.created_at AS asset_created_at
        FROM creation_output_imports imported
        JOIN prompt_series series ON series.id = imported.series_id
        JOIN image_assets asset ON asset.id = imported.image_asset_id
        WHERE series.deleted_at IS NULL AND imported.deleted_at IS NULL AND asset.deleted_at IS NULL
        ORDER BY imported.series_id, imported.created_at DESC, imported.id DESC`,
      )
      .all() as JsonMap[];
    for (const row of importedRows) {
      pushMapped(importedOutputsBySeries, text(row.series_id), this.importedOutputDto(row));
    }

    const transformedOutputsBySeries = new Map<string, ImageTransformOutputDto[]>();
    const transformRows = this.db
      .prepare(
        `SELECT transform.*,
          asset.id AS asset_id, asset.kind AS asset_kind, asset.origin_type AS asset_origin_type,
          asset.width AS asset_width, asset.height AS asset_height, asset.mime_type AS asset_mime_type,
          asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at
        FROM image_transform_runs transform
        JOIN prompt_series series ON series.id = transform.series_id
        JOIN image_assets asset ON asset.id = transform.output_asset_id
        WHERE series.deleted_at IS NULL AND transform.deleted_at IS NULL AND asset.deleted_at IS NULL
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

    return {
      versionRowsBySeries,
      runsByVersion,
      termIdsByVersion,
      paletteReferencesByVersion,
      referenceAssetsByVersion,
      promptInputSnapshotsByVersion,
      importedOutputsBySeries,
      transformedOutputsBySeries,
    };
  }

  private readVersionRelations() {
    const versionRows = this.db
      .prepare(
        `SELECT version.* FROM prompt_versions version
        JOIN prompt_series series ON series.id = version.series_id
        WHERE series.deleted_at IS NULL
        ORDER BY version.series_id, version.version_no DESC`,
      )
      .all() as JsonMap[];
    const versionRowsBySeries = new Map<string, JsonMap[]>();
    for (const row of versionRows) pushMapped(versionRowsBySeries, text(row.series_id), row);

    const promptInputSnapshotsByVersion = new Map<string, PromptInputSnapshotDto>();
    const promptSnapshotRows = this.db
      .prepare(
        `SELECT snapshot.* FROM prompt_input_snapshots snapshot
        JOIN prompt_versions version ON version.id = snapshot.prompt_version_id
        JOIN prompt_series series ON series.id = version.series_id
        WHERE series.deleted_at IS NULL`,
      )
      .all() as JsonMap[];
    for (const row of promptSnapshotRows) {
      promptInputSnapshotsByVersion.set(text(row.prompt_version_id), {
        id: text(row.id),
        sourceKind: text(row.source_kind) as PromptInputSnapshotDto['sourceKind'],
        commonInput: parsePromptCommonInput(row.common_input_json),
        contentHash: text(row.content_hash),
        createdAt: text(row.created_at),
      });
    }
    return { versionRowsBySeries, promptInputSnapshotsByVersion };
  }

  private readRunMetadataRelations(options: { includeExecutionActualRequest?: boolean }) {
    const runSnapshotsById = new Map<
      string,
      {
        modelSnapshot: ImageGenerationRouteSnapshotDto | null;
        executionInputSnapshot: ExecutionInputSnapshotDto | null;
      }
    >();
    const runSnapshotRows = this.db
      .prepare(
        `SELECT model.generation_run_id, model.id AS model_snapshot_id, model.descriptor_json,
          model.content_hash AS model_content_hash, model.created_at AS model_created_at,
          execution.id AS execution_snapshot_id, execution.route_kind, execution.request_schema,
          execution.common_input_json,
          ${options.includeExecutionActualRequest === false ? 'NULL' : 'execution.actual_request_json'} AS actual_request_json,
          execution.client_request_text,
          execution.content_hash AS execution_content_hash, execution.created_at AS execution_created_at
        FROM generation_model_snapshots model
        JOIN execution_input_snapshots execution ON execution.model_snapshot_id = model.id
        JOIN generation_runs run ON run.id = model.generation_run_id
        JOIN prompt_versions version ON version.id = run.prompt_version_id
        JOIN prompt_series series ON series.id = version.series_id
        WHERE series.deleted_at IS NULL`,
      )
      .all() as JsonMap[];
    for (const row of runSnapshotRows) {
      runSnapshotsById.set(text(row.generation_run_id), {
        modelSnapshot: {
          id: text(row.model_snapshot_id),
          descriptor: parsedObject(row.descriptor_json) as unknown as ImageGenerationRouteDto,
          contentHash: text(row.model_content_hash),
          createdAt: text(row.model_created_at),
        },
        executionInputSnapshot: {
          id: text(row.execution_snapshot_id),
          route: text(row.route_kind) as ExecutionInputSnapshotDto['route'],
          requestSchema: text(row.request_schema),
          commonInput: parsedObject(row.common_input_json) as unknown as GenerationExecutionCommonInputDto,
          ...(row.actual_request_json == null ? {} : { actualRequest: parsedObject(row.actual_request_json) }),
          clientRequestText: row.client_request_text == null ? null : text(row.client_request_text),
          contentHash: text(row.execution_content_hash),
          createdAt: text(row.execution_created_at),
        },
      });
    }

    const providerDescriptionsByRun = new Map<string, ProviderReturnedDescriptionDto[]>();
    const providerDescriptionRows = this.db
      .prepare(
        `SELECT description.* FROM provider_returned_descriptions description
        JOIN generation_runs run ON run.id = description.generation_run_id
        JOIN prompt_versions version ON version.id = run.prompt_version_id
        JOIN prompt_series series ON series.id = version.series_id
        WHERE series.deleted_at IS NULL
        ORDER BY description.generation_run_id, description.received_at, description.id`,
      )
      .all() as JsonMap[];
    for (const row of providerDescriptionRows) {
      pushMapped(providerDescriptionsByRun, text(row.generation_run_id), {
        id: text(row.id),
        fieldName: text(row.field_name),
        rawValue: text(row.raw_value),
        interpretation: row.interpretation == null ? null : text(row.interpretation),
        scopeKind: text(row.scope_kind) as ProviderReturnedDescriptionDto['scopeKind'],
        outputOrdinal: Number(row.output_ordinal) < 0 ? null : Number(row.output_ordinal),
        contentHash: text(row.content_hash),
        receivedAt: text(row.received_at),
      });
    }

    const derivationByAssetId = new Map<string, NonNullable<GenerationRunDto['derivation']>>();
    const derivationRows = this.db
      .prepare(
        `SELECT derivation.child_asset_id, derivation.source_asset_id, derivation.relation_type
        FROM asset_derivations derivation
        JOIN generation_runs run ON run.result_asset_id = derivation.child_asset_id
        JOIN prompt_versions version ON version.id = run.prompt_version_id
        JOIN prompt_series series ON series.id = version.series_id
        WHERE series.deleted_at IS NULL
        ORDER BY derivation.child_asset_id, derivation.created_at, derivation.id`,
      )
      .all() as JsonMap[];
    for (const row of derivationRows) {
      const assetId = text(row.child_asset_id);
      if (!derivationByAssetId.has(assetId)) {
        derivationByAssetId.set(assetId, {
          sourceAssetId: text(row.source_asset_id),
          relationType: text(row.relation_type),
        });
      }
    }
    return { runSnapshotsById, providerDescriptionsByRun, derivationByAssetId };
  }

  private readGenerationRuns(relations: {
    runSnapshotsById: Map<
      string,
      {
        modelSnapshot: ImageGenerationRouteSnapshotDto | null;
        executionInputSnapshot: ExecutionInputSnapshotDto | null;
      }
    >;
    providerDescriptionsByRun: Map<string, ProviderReturnedDescriptionDto[]>;
    derivationByAssetId: Map<string, NonNullable<GenerationRunDto['derivation']>>;
  }) {
    const runsByVersion = new Map<string, GenerationRunDto[]>();
    const runRows = this.db
      .prepare(
        `SELECT run.*, job.phase AS job_phase,
          job.progress AS job_progress,
          job.provider_request_id AS job_provider_request_id,
          job_error_event.payload_json AS job_error_payload_json,
          job.retry_of_job_id AS retry_of_job_id,
          retry_run.generation_run_id AS retry_of_run_id,
          codex_thread.thread_id AS codex_thread_id,
          codex_thread.thread_name AS codex_thread_name,
          COALESCE(output_review.disposition, 'VISIBLE') AS output_disposition,
          asset.id AS asset_id, asset.kind AS asset_kind, asset.origin_type AS asset_origin_type,
          asset.width AS asset_width, asset.height AS asset_height, asset.mime_type AS asset_mime_type,
          asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at
        FROM generation_runs run
        JOIN prompt_versions version ON version.id = run.prompt_version_id
        JOIN prompt_series series ON series.id = version.series_id
        JOIN generation_job_links job_link ON job_link.generation_run_id = run.id
        JOIN background_jobs job ON job.id = job_link.job_id
        LEFT JOIN background_job_events job_error_event
          ON job_error_event.job_id = job.id
          AND job_error_event.sequence = (
            SELECT MAX(candidate.sequence)
            FROM background_job_events candidate
            WHERE candidate.job_id = job.id
              AND candidate.event_type IN ('FAILED', 'INTERRUPTED')
          )
        LEFT JOIN background_jobs retry_job ON retry_job.id = job.retry_of_job_id
        LEFT JOIN generation_job_links retry_run ON retry_run.job_id = retry_job.id
        LEFT JOIN generation_output_reviews output_review ON output_review.generation_run_id = run.id
        LEFT JOIN extension_thread_bindings codex_thread
          ON codex_thread.extension_id = ?
          AND codex_thread.scope_kind = 'SYSTEM'
          AND codex_thread.scope_id = 'generation:' || run.id
        LEFT JOIN image_assets asset ON asset.id = run.result_asset_id AND asset.deleted_at IS NULL
        WHERE series.deleted_at IS NULL
        ORDER BY run.prompt_version_id, COALESCE(asset.created_at, run.created_at) DESC, run.created_at DESC, run.id DESC`,
      )
      .all(CODEX_APP_SERVER_EXTENSION_ID) as JsonMap[];
    for (const row of runRows) {
      const runId = text(row.id);
      const asset = joinedAssetDto(row);
      const snapshots = relations.runSnapshotsById.get(runId) ?? {
        modelSnapshot: null,
        executionInputSnapshot: null,
      };
      pushMapped(runsByVersion, text(row.prompt_version_id), {
        id: runId,
        modelKey: text(row.model_key),
        status: text(row.status) as GenerationRunDto['status'],
        outputDisposition: text(row.output_disposition) === 'FAILED' ? 'FAILED' : 'VISIBLE',
        canvasPresetKey: row.canvas_preset_key ? text(row.canvas_preset_key) : null,
        width: nullableDimension(row.width),
        height: nullableDimension(row.height),
        quality: text(row.quality) as GenerationQuality,
        asset,
        derivation: asset ? (relations.derivationByAssetId.get(asset.id) ?? null) : null,
        phase: text(row.job_phase) as GenerationRunPhase,
        progress: row.job_progress == null ? null : Number(row.job_progress),
        providerRequestId: row.job_provider_request_id ? text(row.job_provider_request_id) : null,
        retryOfRunId: row.retry_of_run_id ? text(row.retry_of_run_id) : null,
        errorCode: row.error_code ? text(row.error_code) : null,
        errorMessage: row.error_message ? text(row.error_message) : null,
        errorDetails: generationErrorDetails(row.job_error_payload_json),
        startedAt: row.started_at ? text(row.started_at) : null,
        finishedAt: row.finished_at ? text(row.finished_at) : null,
        createdAt: text(row.created_at),
        ...snapshots,
        providerReturnedDescriptions: relations.providerDescriptionsByRun.get(runId) ?? [],
        codexTask: row.codex_thread_id
          ? { threadId: text(row.codex_thread_id), threadName: text(row.codex_thread_name) }
          : null,
      });
    }
    return runsByVersion;
  }

  getAssetPath(assetId: string): string | null {
    if (!this.assetPathIndex || this.assetPathIndexRevision !== this.storage.getImageAssetRevision()) {
      this.loadAssetPathIndex();
    }
    const indexed = this.assetPathIndex?.get(assetId);
    if (indexed) return indexed;

    // New assets can be committed after the index is built. Resolve only that
    // miss and retain it; normal gallery paints remain one set-oriented read.
    const row = this.db
      .prepare('SELECT relative_path FROM image_assets WHERE id = ? AND deleted_at IS NULL')
      .get(assetId) as JsonMap | undefined;
    const resolved = row ? this.storedAssetPath(row.relative_path) : null;
    if (resolved) this.assetPathIndex?.set(assetId, resolved);
    return resolved;
  }

  hasGenerationReplaySources(): boolean {
    const rows = this.db
      .prepare(
        `SELECT asset.relative_path FROM image_assets asset
        WHERE asset.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM asset_derivations derivation
            WHERE derivation.child_asset_id = asset.id AND derivation.relation_type = 'MODEL_REPLAY'
          )`,
      )
      .iterate() as Iterable<JsonMap>;
    for (const row of rows) {
      if (this.resolveStoredAssetPath(row.relative_path)) return true;
    }
    return false;
  }

  listGenerationReplaySources(): string[] {
    const rows = this.db
      .prepare(
        `SELECT asset.id FROM image_assets asset
        WHERE asset.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM asset_derivations derivation
            WHERE derivation.child_asset_id = asset.id AND derivation.relation_type = 'MODEL_REPLAY'
          )
        ORDER BY asset.created_at, asset.id`,
      )
      .all() as JsonMap[];
    return rows.map((row) => text(row.id)).filter((assetId) => Boolean(this.getAssetPath(assetId)));
  }

  protected assetDto(assetId: string): AssetDto | null {
    const row = this.db.prepare('SELECT * FROM image_assets WHERE id = ? AND deleted_at IS NULL').get(assetId) as
      JsonMap | undefined;
    if (!row) return null;
    return {
      id: assetId,
      kind: text(row.kind) as AssetDto['kind'],
      originType: text(row.origin_type),
      width: Number(row.width),
      height: Number(row.height),
      mimeType: text(row.mime_type),
      byteSize: Number(row.byte_size),
      mediaUrl: mediaUrl(assetId),
      createdAt: text(row.created_at),
    };
  }

  private importedOutputDto(row: JsonMap): ImportedCreationOutputDto {
    const imageAssetId = text(row.image_asset_id);
    return {
      id: text(row.id),
      batchId: text(row.batch_id),
      seriesId: text(row.series_id),
      promptVersionId: row.prompt_version_id ? text(row.prompt_version_id) : null,
      imageAssetId,
      sourceType: text(row.source_type) as ImportedCreationOutputDto['sourceType'],
      originalName: text(row.original_name),
      displayName: text(row.display_name) || text(row.original_name),
      note: text(row.note),
      sourceUrl: text(row.source_url),
      aiGeneratedStatus: text(row.ai_generated_status) as ImportedCreationOutputDto['aiGeneratedStatus'],
      comparisonRole: text(row.comparison_role) as ImportedCreationOutputDto['comparisonRole'],
      executionRouteKey: row.model_key ? text(row.model_key) : null,
      modelName: text(row.model_name),
      modelProvider: text(row.model_provider),
      modelVersion: text(row.model_version),
      generationTextType: text(row.generation_text_type) as ImportedCreationOutputDto['generationTextType'],
      generationText: text(row.generation_text),
      provenanceConfidence: text(row.provenance_confidence) as ImportedCreationOutputDto['provenanceConfidence'],
      codexTask: row.codex_thread_id
        ? {
            threadId: text(row.codex_thread_id),
            threadName: text(row.codex_thread_name) || `Codex ${text(row.codex_thread_id).slice(0, 8)}`,
          }
        : null,
      createdAt: text(row.created_at),
      asset: {
        id: imageAssetId,
        kind: text(row.kind) as AssetDto['kind'],
        originType: text(row.origin_type),
        width: Number(row.width),
        height: Number(row.height),
        mimeType: text(row.mime_type),
        byteSize: Number(row.byte_size),
        mediaUrl: mediaUrl(imageAssetId),
        createdAt: text(row.asset_created_at),
      },
    };
  }

  private assetDerivationDto(childAssetId: string) {
    const row = this.db
      .prepare(
        `SELECT source_asset_id, relation_type FROM asset_derivations
        WHERE child_asset_id = ? ORDER BY created_at, id LIMIT 1`,
      )
      .get(childAssetId) as JsonMap | undefined;
    return row ? { sourceAssetId: text(row.source_asset_id), relationType: text(row.relation_type) } : null;
  }
}
