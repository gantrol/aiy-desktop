import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ulid } from 'ulid';
import type {
  AnnotationBrushGeometry,
  AnnotationDto,
  AnnotationInput,
  AnnotationStatusInput,
  AnnotationUpdateInput,
  AssetDto,
  ExecutionInputSnapshotDto,
  GenerationExecutionCommonInputDto,
  GenerationErrorDetailsDto,
  GenerationInput,
  ImageGenerationRouteDto,
  ImageGenerationRouteSnapshotDto,
  GenerationQuality,
  GenerationRunDto,
  GenerationRunPhase,
  ImageTransformOutputDto,
  ImportedCreationOutputDto,
  Locale,
  PromptCommonInputDto,
  DeletePromptSeriesInput,
  DeletePromptSeriesResult,
  PromptInputSnapshotDto,
  PromptSeriesDto,
  PromptVersionDto,
  ProviderReturnedDescriptionDto,
  RenamePromptSeriesInput,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import type { ExecutionSnapshotRepository } from '@/main/database/execution-snapshot-repository';
import type { GenerationJobRepository } from '@/main/database/generation-job-repository';
import { rehomeCreationInputStashes } from '@/main/database/creation-input-stash-repository';
import { archiveIdeasForSeries, rehomeIdeaCreation } from '@/main/database/idea-creation-lifecycle';
import { CODEX_APP_SERVER_EXTENSION_ID } from '@/shared/extension-ids';
import { annotationDto, type JsonMap, mediaUrl, now, text } from '@/main/database/values';
import { canonicalSnapshotJson, parsePromptCommonInput } from '@/main/database/snapshot-content';
import { databaseBatches, sqlPlaceholders } from '@/main/database/database-batch';
import { ensureImageMaterials } from '@/main/database/image-material-batch';

function jsonStringRecord(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function sortedRecord(value: Record<string, string>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function promptInputWithoutRedundantTextNode(input: PromptCommonInputDto): PromptCommonInputDto {
  const nodes = input.contentNodes;
  if (nodes?.length !== 1 || nodes[0].kind !== 'TEXT' || nodes[0].text.trim() !== input.userInstruction.trim())
    return input;
  const { contentNodes: _contentNodes, ...rest } = input;
  return rest;
}

function samePromptInputAcrossTextComposerUpgrade(left: PromptCommonInputDto, right: PromptCommonInputDto) {
  return (
    canonicalSnapshotJson(promptInputWithoutRedundantTextNode(left)) ===
    canonicalSnapshotJson(promptInputWithoutRedundantTextNode(right))
  );
}

function brushBounds(geometry: AnnotationBrushGeometry, imageWidth: number, imageHeight: number) {
  const shortEdge = Math.max(1, Math.min(imageWidth, imageHeight));
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  let hasEditablePoint = false;
  for (const stroke of geometry.strokes) {
    if (stroke.mode !== 'ADD') continue;
    const radiusX = (stroke.radius * shortEdge) / Math.max(1, imageWidth);
    const radiusY = (stroke.radius * shortEdge) / Math.max(1, imageHeight);
    for (const point of stroke.points) {
      hasEditablePoint = true;
      minX = Math.min(minX, point.x - radiusX);
      minY = Math.min(minY, point.y - radiusY);
      maxX = Math.max(maxX, point.x + radiusX);
      maxY = Math.max(maxY, point.y + radiusY);
    }
  }
  if (!hasEditablePoint) throw new Error('Brush annotations require at least one editable stroke');
  const x = Math.max(0, Math.min(1, minX));
  const y = Math.max(0, Math.min(1, minY));
  const right = Math.max(x, Math.min(1, maxX));
  const bottom = Math.max(y, Math.min(1, maxY));
  return { x, y, width: right - x, height: bottom - y };
}

interface GenerationComposition {
  referenceAssetIds: string[];
  termPromptLocale: Locale;
  termIds: string[];
  wordPaletteReferences: Array<{
    paletteId: string;
    paletteRevisionId: string;
    promptLocale: Locale;
    parameterValues: Record<string, string>;
  }>;
}

interface PreparedPaletteBinding {
  reference: GenerationComposition['wordPaletteReferences'][number];
  normalizedValues: Record<string, string>;
  mediaAssetIds: string[];
}

function normalizedGenerationComposition(input: GenerationInput): GenerationComposition {
  return {
    referenceAssetIds: [...new Set(input.referenceAssetIds)],
    termPromptLocale: input.termPromptLocale === 'zh' ? 'zh' : 'en',
    termIds: [...new Set(input.termIds)],
    wordPaletteReferences: input.wordPaletteReferences.map((reference) => ({
      paletteId: reference.paletteId,
      paletteRevisionId: reference.paletteRevisionId,
      promptLocale: reference.promptLocale,
      parameterValues: sortedRecord(reference.parameterValues),
    })),
  };
}

function nullableDimension(value: unknown): number | null {
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
}

function parsedObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function generationErrorDetails(value: unknown): GenerationErrorDetailsDto | null {
  const payload = parsedObject(value);
  const candidate = payload.errorDetails;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (typeof record.retryable !== 'boolean') return null;
  const metadata = record.metadata;
  return {
    retryable: record.retryable,
    providerCode: typeof record.providerCode === 'string' ? record.providerCode : null,
    metadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {},
  };
}

function pushMapped<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const current = map.get(key);
  if (current) current.push(value);
  else map.set(key, [value]);
}

function joinedAssetDto(row: JsonMap): AssetDto | null {
  if (!row.asset_id) return null;
  const id = text(row.asset_id);
  return {
    id,
    kind: text(row.asset_kind) as AssetDto['kind'],
    originType: text(row.asset_origin_type),
    width: Number(row.asset_width),
    height: Number(row.asset_height),
    mimeType: text(row.asset_mime_type),
    byteSize: Number(row.asset_byte_size),
    mediaUrl: mediaUrl(id),
    createdAt: text(row.asset_created_at),
  };
}

export class WorkbenchRepository {
  private assetPathIndex: Map<string, string> | null = null;
  private assetPathIndexRevision = -1;

  constructor(
    private readonly storage: LibraryStorage,
    private readonly executionSnapshots: ExecutionSnapshotRepository,
    private readonly generationJobs: GenerationJobRepository,
  ) {}

  private get db() {
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

  getWorkbench(_locale: Locale = 'zh'): { series: PromptSeriesDto[] } {
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
    const relations = this.readWorkbenchRelations();
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
      const title = text(seriesRow.title);
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

  /**
   * Reads the workbench graph with a fixed set of set-oriented queries. The
   * previous implementation issued queries for every series, version, run,
   * reference, and snapshot; a large creation history therefore blocked the
   * Electron main loop even though every individual SQLite read was quick.
   */
  private readWorkbenchRelations() {
    const { versionRowsBySeries, promptInputSnapshotsByVersion } = this.readVersionRelations();

    const { runSnapshotsById, providerDescriptionsByRun, derivationByAssetId } = this.readRunMetadataRelations();

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

  private readRunMetadataRelations() {
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
        execution.common_input_json, execution.actual_request_json, execution.client_request_text,
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
          actualRequest: parsedObject(row.actual_request_json),
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

  importReference(sourcePath: string): AssetDto {
    const imported = this.storage.copyIntoObjectStore(sourcePath);
    return this.commitImportedReference(sourcePath, imported);
  }

  async importReferenceAsync(sourcePath: string): Promise<AssetDto> {
    const source = await stat(sourcePath);
    if (!source.isFile() || source.size <= 0 || source.size > 25 * 1024 * 1024) {
      throw new Error('Reference image must be 25 MB or smaller');
    }
    const imported = await this.storage.copyIntoObjectStoreAsync(sourcePath);
    return this.commitImportedReference(sourcePath, imported);
  }

  private commitImportedReference(
    sourcePath: string,
    imported: ReturnType<LibraryStorage['copyIntoObjectStore']>,
  ): AssetDto {
    const existing = this.db
      .prepare('SELECT id FROM image_assets WHERE object_hash = ? AND deleted_at IS NULL')
      .get(imported.hash) as JsonMap | undefined;
    if (existing) return this.assetDto(text(existing.id))!;
    const id = ulid();
    const extension = path.extname(sourcePath).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    this.db
      .prepare(
        `INSERT INTO image_assets
      (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
      VALUES (?, 'REFERENCE', 'LOCAL_IMPORT', ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, imported.hash, imported.relativePath, imported.width, imported.height, mime, imported.byteSize, now());
    this.storage.recordChange('IMAGE_ASSET', id, 'IMPORT', { kind: 'REFERENCE' });
    return this.assetDto(id)!;
  }

  prepareGeneration(
    input: GenerationInput,
    promptInput: PromptCommonInputDto,
    options: { forceNewVersion?: boolean } = {},
  ): { runId: string; versionId: string; seriesId: string; effectiveReferenceAssetIds: string[] } {
    const prepared = this.prepareStructuredVersion(input, promptInput, true, options.forceNewVersion ?? false);
    if (!prepared.runId) throw new Error('Generation run was not created');
    return { ...prepared, runId: prepared.runId };
  }

  saveCreationDraftAsV01(
    input: GenerationInput,
    promptInput: PromptCommonInputDto,
  ): { versionId: string; seriesId: string } {
    return this.savePromptVersion(input, promptInput);
  }

  savePromptVersion(
    input: GenerationInput,
    promptInput: PromptCommonInputDto,
  ): { versionId: string; seriesId: string } {
    const prepared = this.prepareStructuredVersion(input, promptInput, false, false);
    return { versionId: prepared.versionId, seriesId: prepared.seriesId };
  }

  private prepareStructuredVersion(
    input: GenerationInput,
    promptInput: PromptCommonInputDto,
    createRun: boolean,
    forceNewVersion: boolean,
  ): { runId: string | null; versionId: string; seriesId: string; effectiveReferenceAssetIds: string[] } {
    if (!input.prompt.trim()) throw new Error('Prompt is empty');
    const composition = {
      ...normalizedGenerationComposition(input),
      termPromptLocale: promptInput.directTermPromptLocale,
    };
    const sourceAssetId = input.sourceAssetId?.trim() || null;
    if (sourceAssetId && !composition.referenceAssetIds.includes(sourceAssetId)) {
      throw new Error('An image edit source must also be attached as a reference');
    }
    if (sourceAssetId && !this.getAssetPath(sourceAssetId)) {
      throw new Error('Image edit source is unavailable');
    }
    const contentHash = this.executionSnapshots.promptInputHash(promptInput);
    return this.db
      .transaction(() => {
        const { seriesId, current } = this.resolveStructuredSeries(input);
        const { versionId, versionCreated } = this.resolveStructuredPromptVersion({
          input,
          promptInput,
          composition,
          sourceAssetId,
          contentHash,
          seriesId,
          current,
          forceNewVersion,
        });
        const effectiveReferenceAssetIds = this.bindStructuredComposition(versionId, versionCreated, composition);
        const runId = this.createStructuredGenerationRun(input, versionId, createRun);
        if (input.creationDraftId) this.consumeCreationDraft(input.creationDraftId, seriesId, runId);
        if (runId)
          this.storage.recordChange('GENERATION_RUN', runId, 'CREATE', {
            seriesId,
            versionId,
            modelKey: input.modelKey,
          });
        return { runId, versionId, seriesId, effectiveReferenceAssetIds };
      })
      .immediate();
  }

  private resolveStructuredSeries(input: GenerationInput): { seriesId: string; current: JsonMap | undefined } {
    if (input.seriesId) {
      const series = this.db
        .prepare('SELECT current_version_id FROM prompt_series WHERE id = ? AND deleted_at IS NULL')
        .get(input.seriesId) as JsonMap | undefined;
      if (!series) throw new Error('Prompt series not found');
      const selectedVersionId = input.baseVersionId?.trim() || (series.current_version_id as string | null);
      const current = selectedVersionId
        ? (this.db
            .prepare('SELECT * FROM prompt_versions WHERE id = ? AND series_id = ?')
            .get(selectedVersionId, input.seriesId) as JsonMap | undefined)
        : undefined;
      if (selectedVersionId && !current) throw new Error('Selected base prompt version not found');
      return { seriesId: input.seriesId, current };
    }

    if (input.baseVersionId) throw new Error('A base prompt version requires an existing series');

    const targetAlbumId = this.resolveCreationDraftTargetAlbum(input.creationDraftId);
    const seriesId = ulid();
    const title = input.title.trim() || '新创作';
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO prompt_series
        (id, title, current_version_id, created_at, deleted_at, title_zh, title_en)
        VALUES (?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .run(seriesId, title, createdAt, title, '');
    this.storage.recordChange('PROMPT_SERIES', seriesId, 'CREATE', { title });
    if (targetAlbumId) this.attachSeriesToAlbum(targetAlbumId, seriesId, createdAt);
    return { seriesId, current: undefined };
  }

  private resolveCreationDraftTargetAlbum(creationDraftId?: string | null): string | null {
    if (!creationDraftId) return null;
    const draft = this.db
      .prepare(
        `SELECT target_album_id FROM creation_drafts
        WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
      )
      .get(creationDraftId) as JsonMap | undefined;
    if (!draft) throw new Error('Creation draft is no longer available');
    const targetAlbumId = draft.target_album_id ? text(draft.target_album_id) : null;
    if (!targetAlbumId) return null;
    const available = this.db
      .prepare(
        `WITH RECURSIVE lineage(id, archived_at) AS (
          SELECT id, archived_at FROM albums WHERE id = ? AND deleted_at IS NULL
          UNION
          SELECT parent.id, parent.archived_at
          FROM lineage child
          JOIN album_members relation
            ON relation.target_type = 'ALBUM'
            AND relation.target_id = child.id
            AND relation.deleted_at IS NULL
          JOIN albums parent ON parent.id = relation.album_id AND parent.deleted_at IS NULL
        )
        SELECT 1 FROM lineage
        WHERE NOT EXISTS (SELECT 1 FROM lineage WHERE archived_at IS NOT NULL)
        LIMIT 1`,
      )
      .get(targetAlbumId);
    if (!available) throw new Error('The target album is unavailable');
    return targetAlbumId;
  }

  private resolveStructuredPromptVersion(args: {
    input: GenerationInput;
    promptInput: PromptCommonInputDto;
    composition: GenerationComposition;
    sourceAssetId: string | null;
    contentHash: string;
    seriesId: string;
    current: JsonMap | undefined;
    forceNewVersion: boolean;
  }): { versionId: string; versionCreated: boolean } {
    const currentIsStructured = Boolean(args.current) && text(args.current!.composition_mode) === 'STRUCTURED';
    const currentSnapshot = currentIsStructured
      ? this.executionSnapshots.getPromptInputSnapshot(text(args.current!.id))
      : null;
    if (currentIsStructured && !currentSnapshot) {
      throw new Error('Structured prompt version is missing its immutable input snapshot');
    }
    const currentHashMatches = currentIsStructured && currentSnapshot!.contentHash === args.contentHash;
    const currentInputMatches =
      currentHashMatches ||
      (currentIsStructured && samePromptInputAcrossTextComposerUpgrade(currentSnapshot!.commonInput, args.promptInput));
    const currentSourceAssetId = args.current?.source_image_id ? text(args.current.source_image_id) : null;
    const currentSourceMatches = currentIsStructured && currentSourceAssetId === args.sourceAssetId;
    const existingVersionId =
      !args.forceNewVersion && currentInputMatches && currentSourceMatches ? text(args.current!.id) : '';
    if (existingVersionId && text(args.current!.content_hash) !== currentSnapshot!.contentHash) {
      throw new Error('Prompt version hash does not match its immutable input snapshot');
    }
    if (existingVersionId) {
      if (currentHashMatches) this.executionSnapshots.freezePromptInput(existingVersionId, args.promptInput);
      return { versionId: existingVersionId, versionCreated: false };
    }

    const versionId = ulid();
    const versionNo = Number(
      this.db
        .prepare('SELECT COALESCE(MAX(version_no), 0) + 1 FROM prompt_versions WHERE series_id = ?')
        .pluck()
        .get(args.seriesId),
    );
    this.db
      .prepare(
        `INSERT INTO prompt_versions
        (id, series_id, parent_version_id, version_no, user_intent, final_prompt, change_summary,
         source_image_id, content_hash, created_at, composition_mode, term_prompt_locale)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STRUCTURED', ?)`,
      )
      .run(
        versionId,
        args.seriesId,
        args.current?.id ?? null,
        versionNo,
        args.input.manualPrompt,
        args.input.prompt,
        args.input.changeSummary.trim() || `V${String(versionNo).padStart(2, '0')}`,
        args.sourceAssetId,
        args.contentHash,
        now(),
        args.composition.termPromptLocale,
      );
    this.db.prepare('UPDATE prompt_series SET current_version_id = ? WHERE id = ?').run(versionId, args.seriesId);
    this.storage.recordChange('PROMPT_VERSION', versionId, 'CREATE', {
      seriesId: args.seriesId,
      versionNo,
      composition: args.composition,
    });
    this.executionSnapshots.freezePromptInput(versionId, args.promptInput);
    return { versionId, versionCreated: true };
  }

  private bindStructuredComposition(
    versionId: string,
    versionCreated: boolean,
    composition: GenerationComposition,
  ): string[] {
    const paletteBindings = this.preparePaletteBindings(composition.wordPaletteReferences);
    const effectiveReferenceAssetIds = [...composition.referenceAssetIds];
    const effectiveReferenceAssetSet = new Set(effectiveReferenceAssetIds);
    const insertReference = this.db.prepare(
      `INSERT INTO reference_bindings
      (id, prompt_version_id, image_asset_id, sort_order, source_type, source_palette_revision_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertTerm = this.db.prepare(
      `INSERT OR IGNORE INTO prompt_term_bindings
      (id, prompt_version_id, term_id, sort_order) VALUES (?, ?, ?, ?)`,
    );
    const upsertPalette = this.db.prepare(
      `INSERT INTO prompt_palette_bindings
      (id, prompt_version_id, palette_id, palette_revision_id, parameter_values_json, prompt_locale, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(prompt_version_id, palette_id) DO UPDATE SET
        palette_revision_id = excluded.palette_revision_id,
        parameter_values_json = excluded.parameter_values_json, prompt_locale = excluded.prompt_locale,
        sort_order = excluded.sort_order`,
    );

    let referenceSortOrder = 0;
    for (const assetId of composition.referenceAssetIds) {
      if (versionCreated) insertReference.run(ulid(), versionId, assetId, referenceSortOrder, 'DIRECT', null);
      referenceSortOrder += 1;
    }
    for (const [termIndex, termId] of composition.termIds.entries()) {
      insertTerm.run(ulid(), versionId, termId, termIndex);
    }
    for (const [referenceIndex, binding] of paletteBindings.entries()) {
      const { reference } = binding;
      upsertPalette.run(
        ulid(),
        versionId,
        reference.paletteId,
        reference.paletteRevisionId,
        JSON.stringify(binding.normalizedValues),
        reference.promptLocale,
        referenceIndex,
      );
      for (const assetId of binding.mediaAssetIds) {
        if (!effectiveReferenceAssetSet.has(assetId)) {
          effectiveReferenceAssetSet.add(assetId);
          effectiveReferenceAssetIds.push(assetId);
        }
        if (versionCreated) {
          insertReference.run(
            ulid(),
            versionId,
            assetId,
            referenceSortOrder,
            'WORD_PALETTE',
            reference.paletteRevisionId,
          );
        }
        referenceSortOrder += 1;
      }
    }
    return effectiveReferenceAssetIds;
  }

  private preparePaletteBindings(references: GenerationComposition['wordPaletteReferences']): PreparedPaletteBinding[] {
    if (!references.length) return [];
    const revisionIds = [...new Set(references.map((reference) => reference.paletteRevisionId))];
    const paletteIdByRevision = new Map<string, string>();
    const parametersByRevision = new Map<string, JsonMap[]>();
    const optionValuesByParameter = new Map<string, Set<string>>();
    const mediaByRevision = new Map<string, string[]>();

    for (const batch of databaseBatches(revisionIds)) {
      const placeholders = sqlPlaceholders(batch.length);
      const revisionRows = this.db
        .prepare(
          `SELECT revision.id, revision.palette_id
          FROM word_palette_revisions revision
          JOIN word_palettes palette ON palette.id = revision.palette_id
          WHERE revision.id IN (${placeholders}) AND palette.archived_at IS NULL AND palette.deleted_at IS NULL`,
        )
        .all(...batch) as JsonMap[];
      for (const row of revisionRows) paletteIdByRevision.set(text(row.id), text(row.palette_id));

      const parameterRows = this.db
        .prepare(
          `SELECT id, palette_revision_id, stable_key, required
          FROM word_palette_revision_parameters
          WHERE palette_revision_id IN (${placeholders})
          ORDER BY palette_revision_id, rowid`,
        )
        .all(...batch) as JsonMap[];
      for (const row of parameterRows) pushMapped(parametersByRevision, text(row.palette_revision_id), row);

      const optionRows = this.db
        .prepare(
          `SELECT parameter.id AS parameter_id, option.value_key
          FROM word_palette_revision_parameter_options option
          JOIN word_palette_revision_parameters parameter ON parameter.id = option.parameter_revision_id
          WHERE parameter.palette_revision_id IN (${placeholders})`,
        )
        .all(...batch) as JsonMap[];
      for (const row of optionRows) {
        const parameterId = text(row.parameter_id);
        const values = optionValuesByParameter.get(parameterId) ?? new Set<string>();
        values.add(text(row.value_key));
        optionValuesByParameter.set(parameterId, values);
      }

      const mediaRows = this.db
        .prepare(
          `SELECT media.palette_revision_id, media.image_asset_id
          FROM word_palette_revision_media media
          JOIN image_assets asset ON asset.id = media.image_asset_id
          WHERE media.palette_revision_id IN (${placeholders}) AND asset.deleted_at IS NULL
          ORDER BY media.palette_revision_id, media.sort_order, media.rowid`,
        )
        .all(...batch) as JsonMap[];
      for (const row of mediaRows) {
        pushMapped(mediaByRevision, text(row.palette_revision_id), text(row.image_asset_id));
      }
    }

    return references.map((reference) => {
      if (paletteIdByRevision.get(reference.paletteRevisionId) !== reference.paletteId) {
        throw new Error('Word palette not found');
      }
      const normalizedValues: Record<string, string> = {};
      for (const parameter of parametersByRevision.get(reference.paletteRevisionId) ?? []) {
        const stableKey = text(parameter.stable_key);
        const value = reference.parameterValues[stableKey] ?? '';
        if (parameter.required && !value) throw new Error(`Missing word palette parameter: ${stableKey}`);
        if (!value) continue;
        if (!optionValuesByParameter.get(text(parameter.id))?.has(value)) {
          throw new Error(`Invalid word palette parameter: ${stableKey}`);
        }
        normalizedValues[stableKey] = value;
      }
      return {
        reference,
        normalizedValues,
        mediaAssetIds: mediaByRevision.get(reference.paletteRevisionId) ?? [],
      };
    });
  }

  private createStructuredGenerationRun(input: GenerationInput, versionId: string, createRun: boolean): string | null {
    if (!createRun) return null;
    const runId = ulid();
    this.db
      .prepare(
        `INSERT INTO generation_runs
        (id, prompt_version_id, model_key, canvas_preset_key, width, height, quality, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)`,
      )
      .run(
        runId,
        versionId,
        input.modelKey,
        input.canvasPresetKey,
        input.width ?? 0,
        input.height ?? 0,
        input.quality,
        now(),
      );
    this.generationJobs.createForRun(runId);
    return runId;
  }

  private consumeCreationDraft(creationDraftId: string, seriesId: string, runId: string | null) {
    const consumedAt = now();
    const consumed = this.db
      .prepare(
        `UPDATE creation_drafts
        SET consumed_at = ?, source_series_id = ?, updated_at = ?
        WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
      )
      .run(consumedAt, seriesId, consumedAt, creationDraftId);
    if (!consumed.changes) throw new Error('Creation draft is no longer available');
    const assistantRunIds = this.readDraftScopeIds('assistant_runs', creationDraftId);
    const styleExplorationBatchIds = this.readDraftScopeIds('style_exploration_batches', creationDraftId);
    this.db
      .prepare(
        `UPDATE creator_agent_turns SET scope_kind = 'SERIES', scope_id = ?
        WHERE scope_kind = 'DRAFT' AND scope_id = ?`,
      )
      .run(seriesId, creationDraftId);
    this.rehomeDraftScope('assistant_runs', creationDraftId, seriesId, consumedAt);
    this.rehomeDraftScope('style_exploration_batches', creationDraftId, seriesId, consumedAt);
    rehomeIdeaCreation(this.storage, creationDraftId, seriesId);
    rehomeCreationInputStashes(this.storage, creationDraftId, seriesId);
    this.recordScopeRehomeChanges('ASSISTANT_RUN', assistantRunIds, creationDraftId, seriesId);
    this.recordScopeRehomeChanges('STYLE_EXPLORATION_BATCH', styleExplorationBatchIds, creationDraftId, seriesId);
    this.storage.recordChange('CREATION_DRAFT', creationDraftId, 'CONSUME', { seriesId, runId });
  }

  private readDraftScopeIds(table: 'assistant_runs' | 'style_exploration_batches', creationDraftId: string): string[] {
    return (
      this.db
        .prepare(`SELECT id FROM ${table} WHERE scope_kind = 'DRAFT' AND scope_id = ?`)
        .all(creationDraftId) as JsonMap[]
    ).map((row) => text(row.id));
  }

  private rehomeDraftScope(
    table: 'assistant_runs' | 'style_exploration_batches',
    creationDraftId: string,
    seriesId: string,
    updatedAt: string,
  ) {
    this.db
      .prepare(
        `UPDATE ${table} SET scope_kind = 'SERIES', scope_id = ?, updated_at = ?
        WHERE scope_kind = 'DRAFT' AND scope_id = ?`,
      )
      .run(seriesId, updatedAt, creationDraftId);
  }

  private recordScopeRehomeChanges(
    entityType: 'ASSISTANT_RUN' | 'STYLE_EXPLORATION_BATCH',
    ids: string[],
    creationDraftId: string,
    seriesId: string,
  ) {
    for (const id of ids) {
      this.storage.recordChange(entityType, id, 'REHOME_SCOPE', {
        from: { kind: 'DRAFT', id: creationDraftId },
        to: { kind: 'SERIES', id: seriesId },
      });
    }
  }

  private attachSeriesToAlbum(albumId: string, seriesId: string, timestamp: string) {
    const sortOrder = Number(
      (
        this.db
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
      FROM album_members WHERE album_id = ? AND deleted_at IS NULL`,
          )
          .get(albumId) as JsonMap
      ).next_order,
    );
    const memberId = ulid();
    this.db
      .prepare(
        `INSERT INTO album_members
      (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
      VALUES (?, ?, 'SERIES', ?, ?, ?, ?, NULL)`,
      )
      .run(memberId, albumId, seriesId, sortOrder, timestamp, timestamp);
    this.db
      .prepare(
        `UPDATE albums SET updated_at = ?, content_updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(timestamp, timestamp, albumId);
    this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
      albumId,
      targetType: 'SERIES',
      targetId: seriesId,
    });
  }

  prepareGenerationRetry(sourceRunId: string) {
    return this.db.transaction(() => {
      const source = this.db
        .prepare(
          `SELECT run.*, version.series_id, version.user_intent,
          version.final_prompt, version.change_summary, version.composition_mode, version.term_prompt_locale,
          version.source_image_id,
          series.title, series.title_zh, series.title_en
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

  prepareGenerationFromVersion(versionId: string, modelKey: string) {
    return this.db.transaction(() => {
      const source = this.db
        .prepare(
          `SELECT version.*, series.title, series.title_zh, series.title_en,
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
      const canvasPresetKey = source.canvas_preset_key ? text(source.canvas_preset_key) : null;
      const width = nullableDimension(source.width);
      const height = nullableDimension(source.height);
      const quality = ['low', 'medium', 'high'].includes(text(source.quality))
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
      const row = this.db
        .prepare('SELECT title, title_zh, title_en FROM prompt_series WHERE id = ? AND deleted_at IS NULL')
        .get(input.seriesId) as JsonMap | undefined;
      if (!row) throw new Error('Prompt series not found');
      const currentTitle = text(row.title);
      if (input.expectedTitle !== undefined && currentTitle !== input.expectedTitle.trim()) {
        return { renamed: false };
      }
      const title = input.title.trim() || currentTitle || '新创作';
      this.db
        .prepare('UPDATE prompt_series SET title = ?, title_zh = ?, title_en = ? WHERE id = ?')
        .run(title, title, '', input.seriesId);
      this.storage.recordChange('PROMPT_SERIES', input.seriesId, 'RENAME', { title });
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
                WHERE material.kind = 'IMAGE' AND material.image_asset_id = asset.id
                  AND material.deleted_at IS NULL
              ) AND NOT EXISTS (
                SELECT 1 FROM materials material
                JOIN material_favorites favorite ON favorite.material_id = material.id
                  AND favorite.deleted_at IS NULL
                WHERE material.kind = 'IMAGE' AND material.image_asset_id = asset.id
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

  listAnnotations(assetId: string): AnnotationDto[] {
    return (
      this.db
        .prepare(
          `SELECT annotation.*, region.geometry_json
      FROM annotations annotation
      LEFT JOIN annotation_regions region ON region.annotation_id = annotation.id
      WHERE annotation.image_asset_id = ? ORDER BY annotation.created_at`,
        )
        .all(assetId) as JsonMap[]
    ).map(annotationDto);
  }

  addAnnotation(input: AnnotationInput): AnnotationDto {
    return this.db.transaction(() => {
      const id = ulid();
      const createdAt = now();
      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      let geometry: AnnotationBrushGeometry | null = null;
      let x = clamp(input.x);
      let y = clamp(input.y);
      let width = input.width == null ? null : clamp(input.width);
      let height = input.height == null ? null : clamp(input.height);
      if (input.type === 'BRUSH') {
        if (!input.geometry) throw new Error('Brush annotation geometry is required');
        const asset = this.db
          .prepare(
            `SELECT width, height FROM image_assets
          WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(input.imageAssetId) as JsonMap | undefined;
        if (!asset) throw new Error('Annotation image is unavailable');
        geometry = input.geometry;
        const bounds = brushBounds(geometry, Number(asset.width), Number(asset.height));
        ({ x, y, width, height } = bounds);
      }
      this.db
        .prepare(
          `INSERT INTO annotations
        (id, image_asset_id, type, x, y, width, height, comment, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
        )
        .run(id, input.imageAssetId, input.type, x, y, width, height, input.comment.trim(), createdAt);
      let geometryHash: string | null = null;
      if (geometry) {
        const geometryJson = JSON.stringify(geometry);
        geometryHash = createHash('sha256').update(geometryJson).digest('hex');
        this.db
          .prepare(
            `INSERT INTO annotation_regions
          (annotation_id, schema_version, geometry_json, content_hash, created_at)
          VALUES (?, 1, ?, ?, ?)`,
          )
          .run(id, geometryJson, geometryHash, createdAt);
      }
      this.storage.recordChange('ANNOTATION', id, 'CREATE', {
        imageAssetId: input.imageAssetId,
        type: input.type,
        geometryHash,
      });
      return {
        id,
        imageAssetId: input.imageAssetId,
        type: input.type,
        x,
        y,
        width,
        height,
        geometry,
        comment: input.comment.trim(),
        status: 'OPEN' as const,
        createdAt,
      };
    })();
  }

  updateAnnotation(input: AnnotationUpdateInput): AnnotationDto {
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT annotation.*, region.geometry_json
        FROM annotations annotation
        LEFT JOIN annotation_regions region ON region.annotation_id = annotation.id
        WHERE annotation.id = ?`,
        )
        .get(input.annotationId) as JsonMap | undefined;
      if (!row) throw new Error(`Annotation not found: ${input.annotationId}`);
      const annotation = annotationDto(row);
      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      let geometry: AnnotationBrushGeometry | null = null;
      let x = clamp(input.x);
      let y = clamp(input.y);
      let width = input.width == null ? null : clamp(input.width);
      let height = input.height == null ? null : clamp(input.height);
      if (input.type === 'BRUSH') {
        if (!input.geometry) throw new Error('Brush annotation geometry is required');
        const asset = this.db
          .prepare(
            `SELECT width, height FROM image_assets
          WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(annotation.imageAssetId) as JsonMap | undefined;
        if (!asset) throw new Error('Annotation image is unavailable');
        geometry = input.geometry;
        const bounds = brushBounds(geometry, Number(asset.width), Number(asset.height));
        ({ x, y, width, height } = bounds);
      }
      const comment = input.comment.trim();
      this.db
        .prepare(
          `UPDATE annotations
        SET type = ?, x = ?, y = ?, width = ?, height = ?, comment = ?
        WHERE id = ?`,
        )
        .run(input.type, x, y, width, height, comment, input.annotationId);
      let geometryHash: string | null = null;
      if (geometry) {
        const geometryJson = JSON.stringify(geometry);
        geometryHash = createHash('sha256').update(geometryJson).digest('hex');
        this.db
          .prepare(
            `INSERT INTO annotation_regions
          (annotation_id, schema_version, geometry_json, content_hash, created_at)
          VALUES (?, 1, ?, ?, ?)
          ON CONFLICT(annotation_id) DO UPDATE SET
            schema_version = excluded.schema_version,
            geometry_json = excluded.geometry_json,
            content_hash = excluded.content_hash`,
          )
          .run(input.annotationId, geometryJson, geometryHash, now());
      } else {
        this.db.prepare('DELETE FROM annotation_regions WHERE annotation_id = ?').run(input.annotationId);
      }
      this.storage.recordChange('ANNOTATION', input.annotationId, 'UPDATE', {
        imageAssetId: annotation.imageAssetId,
        type: input.type,
        geometryHash,
        commentChanged: comment !== annotation.comment,
      });
      return {
        ...annotation,
        type: input.type,
        x,
        y,
        width,
        height,
        geometry,
        comment,
      };
    })();
  }

  setAnnotationStatus(input: AnnotationStatusInput): AnnotationDto {
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT annotation.*, region.geometry_json
        FROM annotations annotation
        LEFT JOIN annotation_regions region ON region.annotation_id = annotation.id
        WHERE annotation.id = ?`,
        )
        .get(input.annotationId) as JsonMap | undefined;
      if (!row) throw new Error(`Annotation not found: ${input.annotationId}`);
      const annotation = annotationDto(row);
      if (annotation.status === input.status) return annotation;

      this.db.prepare('UPDATE annotations SET status = ? WHERE id = ?').run(input.status, input.annotationId);
      this.storage.recordChange('ANNOTATION', input.annotationId, 'SET_STATUS', {
        imageAssetId: annotation.imageAssetId,
        from: annotation.status,
        to: input.status,
      });
      return { ...annotation, status: input.status };
    })();
  }

  getReferencePaths(assetIds: string[]) {
    return assetIds.map((id) => this.getAssetPath(id)).filter((item): item is string => Boolean(item));
  }

  getLibraryName() {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key = 'library_name'").get() as JsonMap | undefined;
    return text(row?.value) || '本地图鉴';
  }

  private assetDto(assetId: string): AssetDto | null {
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
      modelKey: row.model_key ? text(row.model_key) : null,
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
