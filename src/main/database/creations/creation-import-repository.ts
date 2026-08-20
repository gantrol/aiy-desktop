import path from 'node:path';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  AssetDto,
  CodexTaskReferenceDto,
  CreatorImageImportContext,
  CreatorImageImportInput,
  CreatorImageImportItemInput,
  CreatorOutputsOrganizeInput,
  CreatorOutputsOrganizeResult,
  CreatorOutputsImportResult,
  CreatorStagedOutputImportItemInput,
  ImportedCreationOutputDto,
  ImportedCreationOutputUpdateInput,
  NewExternalCreationImportInput,
  NewExternalCreationImportResult,
  PromptCommonInputDto,
} from '@/shared/contracts';
import type { LibraryStorage, StoredObject } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';
import type { ExecutionSnapshotRepository } from '@/main/database/generation/execution-snapshot-repository';
import { rehomeCreationInputStashes } from '@/main/database/creations/creation-input-stash-repository';
import { rehomeIdeaCreation } from '@/main/database/creations/idea-creation-lifecycle';
import { sameImportedModelIdentity } from '@/main/database/assets/imported-image-metadata';
import {
  linkExistingImportedOutput,
  type ExistingImportedOutputLinkInput,
} from '@/main/database/creations/imported-output-linker';
import { insertCreationOutputBatch } from '@/main/database/creations/creation-output-import-batch';
import { organizeCreationOutputs } from '@/main/database/creations/creation-output-organizer';
import { updatedCreationOutputProvenanceConfidence } from '@/main/database/creations/creation-output-provenance';
import { imageDimensions } from '@/main/media/image-dimensions';

const maxImageCount = 8;
const maxImageBytes = 25 * 1024 * 1024;
const maxBatchBytes = 100 * 1024 * 1024;
const maxImageHeaderBytes = 4 * 1024 * 1024;

const extensionByMimeType = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
} as const;

export interface StoredCreatorImage {
  item: Pick<CreatorImageImportItemInput, 'id' | 'name' | 'mimeType' | 'metadata'>;
  stored: StoredObject;
}

interface StagedBatch {
  images: StoredCreatorImage[];
  duplicateCount: number;
}

interface OutputImportContext {
  seriesId: string;
  promptVersionId: string | null;
  source: CreatorImageImportInput['context']['source'];
  sourceUrl: string;
  exactPrompt: string | null;
  codexTask?: CodexTaskReferenceDto | null;
}

interface ImportedOutputUpdateOptions {
  /** Internal evidence override. User-facing update IPC never supplies this. */
  provenanceConfidence?: ImportedCreationOutputDto['provenanceConfidence'];
}

function hasExpectedSignature(item: CreatorImageImportItemInput) {
  const bytes = item.bytes;
  if (item.mimeType === 'image/png') {
    return bytes.byteLength >= 8 && Buffer.from(bytes.subarray(0, 8)).toString('hex') === '89504e470d0a1a0a';
  }
  if (item.mimeType === 'image/jpeg') {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (item.mimeType === 'image/svg+xml') {
    return (
      imageDimensions(
        Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, maxImageHeaderBytes)),
        '.svg',
      ) !== null
    );
  }
  return (
    bytes.byteLength >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  );
}

export class CreationImportRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly executionSnapshots: ExecutionSnapshotRepository,
  ) {}

  private get db() {
    return this.storage.db;
  }

  importReferences(input: CreatorImageImportInput): AssetDto[] {
    const staged = this.stage(input.items).images;
    return this.importStoredReferences(input.context.source, staged);
  }

  importStoredReferences(source: CreatorImageImportContext['source'], images: StoredCreatorImage[]): AssetDto[] {
    const staged = this.stagedStoredImages(images);
    return this.db
      .transaction(() => {
        const assets = new Map<string, AssetDto>();
        for (const image of staged.images) {
          const assetId = this.ensureReferenceAsset(image, source);
          if (!assets.has(assetId)) assets.set(assetId, this.assetDto(assetId));
        }
        return [...assets.values()];
      })
      .immediate();
  }

  importOutputs(input: CreatorImageImportInput): CreatorOutputsImportResult {
    const staged = this.stage(input.items);
    return this.db
      .transaction(() => {
        const seriesId = this.resolveSeries(input.context, staged.images[0]?.item.name);
        return this.insertOutputs(
          {
            seriesId,
            promptVersionId: input.context.versionId,
            source: input.context.source,
            sourceUrl: input.context.sourceUrl?.trim() ?? '',
            exactPrompt: null,
          },
          staged,
        );
      })
      .immediate();
  }

  importStoredOutputs(
    context: CreatorImageImportContext,
    images: StoredCreatorImage[],
    items: readonly CreatorStagedOutputImportItemInput[],
  ): CreatorOutputsImportResult {
    const staged = this.stagedStoredImages(images);
    if (items.length !== staged.images.length) throw new Error('Imported output details do not match staged images');
    return this.db
      .transaction(() => {
        const seriesId = this.resolveSeries(context, images[0]?.item.name);
        return this.insertOutputs(
          {
            seriesId,
            promptVersionId: context.versionId,
            source: context.source,
            sourceUrl: context.sourceUrl?.trim() ?? '',
            exactPrompt: null,
          },
          staged,
          items,
        );
      })
      .immediate();
  }

  /** Attach a material-library asset to an existing creation during intake review. */
  linkExistingAsset(input: ExistingImportedOutputLinkInput): ImportedCreationOutputDto {
    return linkExistingImportedOutput(this.storage, input, (outputId) => this.outputDto(outputId));
  }

  importNewExternalCreation(input: NewExternalCreationImportInput): NewExternalCreationImportResult {
    const staged = this.stage(input.outputs, true);
    return this.commitNewExternalCreation(input, staged);
  }

  importStoredNewExternalCreation(
    input: NewExternalCreationImportInput,
    images: StoredCreatorImage[],
    duplicateCount = 0,
    codexTask: CodexTaskReferenceDto | null = null,
  ): NewExternalCreationImportResult {
    const staged = this.stagedStoredImages(images, true);
    staged.duplicateCount = duplicateCount;
    return this.commitNewExternalCreation(input, staged, codexTask);
  }

  private commitNewExternalCreation(
    input: NewExternalCreationImportInput,
    staged: StagedBatch,
    codexTask: CodexTaskReferenceDto | null = null,
  ): NewExternalCreationImportResult {
    const sourceKind = input.sourceKind ?? 'EXTERNAL_IMPORT';
    const outputSource = input.source ?? 'UPLOAD';
    const exactPrompt = input.prompt.knowledge === 'EXACT' ? input.prompt.text.trim() : '';
    if (input.prompt.knowledge === 'EXACT' && !exactPrompt) throw new Error('Exact Prompt is required');
    if (sourceKind === 'MANUAL_PROMPT' && input.prompt.knowledge !== 'EXACT') {
      throw new Error('A manual Prompt creation requires an exact Prompt');
    }
    return this.db
      .transaction(() => {
        if (
          input.albumId &&
          !this.db
            .prepare(
              `SELECT 1 FROM albums
        WHERE id = ? AND deleted_at IS NULL`,
            )
            .get(input.albumId)
        )
          throw new Error('Album not found');

        const createdAt = now();
        const seriesId = ulid();
        const versionId = ulid();
        const requestedTitle = input.title.trim();
        const inferredTitleBase =
          !requestedTitle && staged.images[0]?.item.name ? path.parse(staged.images[0].item.name).name.trim() : '';
        const inferredTitle = inferredTitleBase ? this.availableSeriesTitle(inferredTitleBase) : '';
        const title = requestedTitle || inferredTitle || '新创作';
        const titleLocale = input.titleLocale ?? 'zh';
        this.db
          .prepare(
            `INSERT INTO prompt_series
        (id, title, title_locale, current_version_id, created_at, deleted_at)
        VALUES (?, ?, ?, NULL, ?, NULL)`,
          )
          .run(seriesId, title, titleLocale, createdAt);
        this.storage.recordChange('PROMPT_SERIES', seriesId, 'CREATE', {
          title,
          locale: titleLocale,
          source: sourceKind,
        });

        const promptInput: PromptCommonInputDto = {
          userInstruction: exactPrompt,
          directTermPromptLocale: 'en',
          directTerms: [],
          recipes: [],
          directReferences: [],
          flatPrompt: exactPrompt,
        };
        const contentHash = this.executionSnapshots.promptInputHash(promptInput);
        this.db
          .prepare(
            `INSERT INTO prompt_versions
        (id, series_id, parent_version_id, version_no, user_intent, final_prompt, change_summary,
          source_image_id, content_hash, created_at, composition_mode, term_prompt_locale,
          origin_type, prompt_knowledge)
        VALUES (?, ?, NULL, 1, ?, ?, ?, NULL, ?, ?, 'FLATTENED', 'en', ?, ?)`,
          )
          .run(
            versionId,
            seriesId,
            exactPrompt,
            exactPrompt,
            sourceKind,
            contentHash,
            createdAt,
            sourceKind,
            input.prompt.knowledge,
          );
        this.db.prepare('UPDATE prompt_series SET current_version_id = ? WHERE id = ?').run(versionId, seriesId);
        this.executionSnapshots.freezePromptInput(versionId, promptInput);
        this.storage.recordChange('PROMPT_VERSION', versionId, 'CREATE', {
          seriesId,
          versionNo: 1,
          originType: sourceKind,
          promptKnowledge: input.prompt.knowledge,
        });

        if (input.albumId) this.attachSeriesToAlbum(input.albumId, seriesId, createdAt);
        const imported = this.insertOutputs(
          {
            seriesId,
            promptVersionId: versionId,
            source: outputSource,
            sourceUrl: input.sourceUrl?.trim() ?? '',
            exactPrompt: input.prompt.knowledge === 'EXACT' ? exactPrompt : null,
            codexTask,
          },
          staged,
        );
        if (input.creationDraftId) {
          if (sourceKind !== 'MANUAL_PROMPT')
            throw new Error('Only a manual Prompt creation can consume a creation draft');
          const consumed = this.db
            .prepare(
              `UPDATE creation_drafts
          SET consumed_at = ?, source_series_id = ?, updated_at = ?
          WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
            )
            .run(createdAt, seriesId, createdAt, input.creationDraftId);
          if (!consumed.changes) throw new Error('Creation draft is no longer available');
          this.db
            .prepare(
              `UPDATE creator_agent_turns SET scope_kind = 'SERIES', scope_id = ?
          WHERE scope_kind = 'DRAFT' AND scope_id = ?`,
            )
            .run(seriesId, input.creationDraftId);
          const assistantRunIds = (
            this.db
              .prepare(
                `SELECT id FROM assistant_runs
          WHERE scope_kind = 'DRAFT' AND scope_id = ?`,
              )
              .all(input.creationDraftId) as JsonMap[]
          ).map((row) => text(row.id));
          const styleExplorationBatchIds = (
            this.db
              .prepare(
                `SELECT id FROM style_exploration_batches
          WHERE scope_kind = 'DRAFT' AND scope_id = ?`,
              )
              .all(input.creationDraftId) as JsonMap[]
          ).map((row) => text(row.id));
          this.db
            .prepare(
              `UPDATE assistant_runs
          SET scope_kind = 'SERIES', scope_id = ?, updated_at = ?
          WHERE scope_kind = 'DRAFT' AND scope_id = ?`,
            )
            .run(seriesId, createdAt, input.creationDraftId);
          this.db
            .prepare(
              `UPDATE style_exploration_batches
          SET scope_kind = 'SERIES', scope_id = ?, updated_at = ?
          WHERE scope_kind = 'DRAFT' AND scope_id = ?`,
            )
            .run(seriesId, createdAt, input.creationDraftId);
          rehomeIdeaCreation(this.storage, input.creationDraftId, seriesId);
          rehomeCreationInputStashes(this.storage, input.creationDraftId, seriesId);
          for (const assistantRunId of assistantRunIds) {
            this.storage.recordChange('ASSISTANT_RUN', assistantRunId, 'REHOME_SCOPE', {
              from: { kind: 'DRAFT', id: input.creationDraftId },
              to: { kind: 'SERIES', id: seriesId },
            });
          }
          for (const batchId of styleExplorationBatchIds) {
            this.storage.recordChange('STYLE_EXPLORATION_BATCH', batchId, 'REHOME_SCOPE', {
              from: { kind: 'DRAFT', id: input.creationDraftId },
              to: { kind: 'SERIES', id: seriesId },
            });
          }
          this.storage.recordChange('CREATION_DRAFT', input.creationDraftId, 'CONSUME', { seriesId, versionId });
        }
        return { ...imported, versionId, albumId: input.albumId ?? null };
      })
      .immediate();
  }

  private stagedStoredImages(images: StoredCreatorImage[], allowEmpty = false): StagedBatch {
    if (!images.length && !allowEmpty) throw new Error('Nothing to import');
    if (images.length > maxImageCount) throw new Error(`Import supports at most ${maxImageCount} images`);
    const totalBytes = images.reduce((total, image) => total + image.stored.byteSize, 0);
    if (
      images.some((image) => image.stored.byteSize <= 0 || image.stored.byteSize > maxImageBytes) ||
      totalBytes > maxBatchBytes
    ) {
      throw new Error('Import must be 100 MB or smaller');
    }
    return { images, duplicateCount: 0 };
  }

  updateOutput(input: ImportedCreationOutputUpdateInput, options: ImportedOutputUpdateOptions = {}) {
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('Name is required');
    const output = this.db
      .prepare(
        `SELECT series_id, display_name, source_url, model_key, ai_generated_status, comparison_role,
          model_name, model_provider, model_version, generation_text_type, generation_text, provenance_confidence
        FROM creation_output_imports
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(input.outputId) as JsonMap | undefined;
    if (!output) throw new Error('Imported output not found');
    if (
      input.promptVersionId &&
      !this.db
        .prepare(
          `SELECT 1 FROM prompt_versions
      WHERE id = ? AND series_id = ?`,
        )
        .get(input.promptVersionId, output.series_id)
    ) {
      throw new Error('Prompt version does not belong to the imported output series');
    }
    const hasModel = Boolean(input.modelName.trim());
    const comparisonRole = input.aiGeneratedStatus === 'NO' ? 'ACTUAL' : hasModel ? 'MODEL' : 'UNKNOWN';
    const aiGeneratedStatus = hasModel && input.aiGeneratedStatus === 'UNKNOWN' ? 'YES' : input.aiGeneratedStatus;
    const keepGenerationMetadata = aiGeneratedStatus !== 'NO';
    const modelName = keepGenerationMetadata ? input.modelName.trim() : '';
    const modelProvider = keepGenerationMetadata ? input.modelProvider.trim() : '';
    const modelVersion = keepGenerationMetadata ? input.modelVersion.trim() : '';
    const generationText = input.generationText.trim();
    // `model_key` is the legacy storage column for a verified execution route.
    // Free-text provenance edits may preserve that route, but can never assign one.
    const executionRouteKey =
      comparisonRole === 'MODEL' &&
      sameImportedModelIdentity(
        { modelName, modelProvider, modelVersion },
        {
          modelName: text(output.model_name),
          modelProvider: text(output.model_provider),
          modelVersion: text(output.model_version),
        },
      )
        ? output.model_key
          ? text(output.model_key)
          : null
        : null;
    const sourceUrl = input.sourceUrl.trim();
    const provenanceConfidence = updatedCreationOutputProvenanceConfidence(
      output,
      {
        sourceUrl,
        aiGeneratedStatus,
        comparisonRole,
        modelName,
        modelProvider,
        modelVersion,
        generationTextType: input.generationTextType,
        generationText,
      },
      options.provenanceConfidence,
    );
    const result = this.db
      .prepare(
        `UPDATE creation_output_imports SET
        prompt_version_id = ?, display_name = ?, note = ?, source_url = ?, ai_generated_status = ?, model_key = ?,
        model_name = ?, model_provider = ?, model_version = ?, generation_text_type = ?,
        generation_text = ?, provenance_confidence = ?, comparison_role = ?
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        input.promptVersionId,
        displayName,
        input.note.trim(),
        sourceUrl,
        aiGeneratedStatus,
        executionRouteKey,
        modelName,
        modelProvider,
        modelVersion,
        input.generationTextType,
        generationText,
        provenanceConfidence,
        comparisonRole,
        input.outputId,
      );
    if (!result.changes) throw new Error('Imported output not found');
    this.storage.recordChange(
      'CREATION_OUTPUT_IMPORT',
      input.outputId,
      'UPDATE',
      {
        displayName,
        promptVersionId: input.promptVersionId,
      },
      { affectsFileView: displayName !== text(output.display_name) },
    );
    return this.outputDto(input.outputId);
  }

  organizeOutputs(input: CreatorOutputsOrganizeInput): CreatorOutputsOrganizeResult {
    return organizeCreationOutputs(this.storage, input, (outputId) => this.outputDto(outputId));
  }

  private stage(items: CreatorImageImportItemInput[], allowEmpty = false): StagedBatch {
    if (!items.length && !allowEmpty) throw new Error('Nothing to import');
    if (items.length > maxImageCount) throw new Error(`Import supports at most ${maxImageCount} images`);
    let totalBytes = 0;
    const uniqueItems: CreatorImageImportItemInput[] = [];
    const seenHashes = new Set<string>();
    let duplicateCount = 0;
    for (const item of items) {
      if (!item.bytes.byteLength || item.bytes.byteLength > maxImageBytes) {
        throw new Error('Each image must be 25 MB or smaller');
      }
      totalBytes += item.bytes.byteLength;
      if (totalBytes > maxBatchBytes) throw new Error('Import must be 100 MB or smaller');
      if (!hasExpectedSignature(item)) throw new Error(`Invalid ${item.mimeType} image: ${item.name}`);
      const hash = createHash('sha256').update(item.bytes).digest('hex');
      if (seenHashes.has(hash)) {
        duplicateCount += 1;
        continue;
      }
      seenHashes.add(hash);
      uniqueItems.push(item);
    }
    return {
      images: uniqueItems.map((item) => ({
        item,
        stored: this.storage.storeBuffer(item.bytes, extensionByMimeType[item.mimeType]),
      })),
      duplicateCount,
    };
  }

  private insertOutputs(
    context: OutputImportContext,
    staged: StagedBatch,
    items: readonly CreatorStagedOutputImportItemInput[] = [],
  ): CreatorOutputsImportResult {
    return insertCreationOutputBatch({
      storage: this.storage,
      context,
      staged,
      items,
      ensureReferenceAsset: (image, source) => this.ensureReferenceAsset(image, source),
      availableDisplayName: (name, used) => this.availableDisplayName(name, used),
      outputDto: (outputId) => this.outputDto(outputId),
    });
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

  private availableDisplayName(originalName: string, used: Set<string>) {
    const extension = path.extname(originalName);
    const base = path.basename(originalName, extension) || 'image';
    let candidate = originalName;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) candidate = `${base} (${suffix++})${extension}`;
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  private resolveSeries(context: CreatorImageImportContext, firstOriginalName?: string) {
    if (context.seriesId) {
      const series = this.db
        .prepare(
          `SELECT id FROM prompt_series
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .get(context.seriesId) as JsonMap | undefined;
      if (!series) throw new Error('Prompt series not found');
      if (context.versionId) {
        const version = this.db
          .prepare(
            `SELECT id FROM prompt_versions
          WHERE id = ? AND series_id = ?`,
          )
          .get(context.versionId, context.seriesId) as JsonMap | undefined;
        if (!version) throw new Error('Prompt version does not belong to the selected series');
      }
      return context.seriesId;
    }
    if (context.versionId) throw new Error('A prompt version requires a prompt series');

    const seriesId = ulid();
    const requestedTitle = context.title.trim();
    const inferredTitleBase = !requestedTitle && firstOriginalName ? path.parse(firstOriginalName).name.trim() : '';
    const inferredTitle = inferredTitleBase ? this.availableSeriesTitle(inferredTitleBase) : '';
    const title = requestedTitle || inferredTitle || '新创作';
    const titleLocale = context.titleLocale ?? 'zh';
    this.db
      .prepare(
        `INSERT INTO prompt_series
      (id, title, title_locale, current_version_id, created_at, deleted_at)
      VALUES (?, ?, ?, NULL, ?, NULL)`,
      )
      .run(seriesId, title, titleLocale, now());
    this.storage.recordChange('PROMPT_SERIES', seriesId, 'CREATE', {
      title,
      locale: titleLocale,
      source: context.source,
    });
    return seriesId;
  }

  private availableSeriesTitle(base: string) {
    const used = new Set(
      (
        this.db
          .prepare(
            `SELECT title FROM prompt_series WHERE deleted_at IS NULL
            UNION ALL
            SELECT localization.title
            FROM prompt_series_localizations localization
            JOIN prompt_series series ON series.id = localization.prompt_series_id
            WHERE series.deleted_at IS NULL`,
          )
          .all() as JsonMap[]
      )
        .map((row) => text(row.title))
        .filter(Boolean)
        .map((value) => value.toLocaleLowerCase()),
    );
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) candidate = `${base} (${suffix++})`;
    return candidate;
  }

  private ensureReferenceAsset(image: StoredCreatorImage, originType: string) {
    const existing = this.db
      .prepare(
        `SELECT id FROM image_assets
      WHERE kind = 'REFERENCE' AND object_hash = ? AND deleted_at IS NULL
      ORDER BY created_at, id LIMIT 1`,
      )
      .get(image.stored.hash) as JsonMap | undefined;
    if (existing) return text(existing.id);

    const assetId = ulid();
    this.db
      .prepare(
        `INSERT INTO image_assets
      (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
      VALUES (?, 'REFERENCE', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        assetId,
        originType,
        image.stored.hash,
        image.stored.relativePath,
        image.stored.width,
        image.stored.height,
        image.item.mimeType,
        image.stored.byteSize,
        now(),
      );
    this.storage.recordChange('IMAGE_ASSET', assetId, 'IMPORT', { kind: 'REFERENCE', originType });
    return assetId;
  }

  private outputDto(outputId: string): ImportedCreationOutputDto {
    const row = this.db
      .prepare(
        `SELECT output.*, asset.kind, asset.origin_type, asset.width, asset.height,
        asset.mime_type, asset.byte_size, asset.created_at AS asset_created_at
      FROM creation_output_imports output
      JOIN image_assets asset ON asset.id = output.image_asset_id
      WHERE output.id = ? AND output.deleted_at IS NULL AND asset.deleted_at IS NULL`,
      )
      .get(outputId) as JsonMap | undefined;
    if (!row) throw new Error('Imported creation output not found');
    return {
      id: text(row.id),
      batchId: text(row.batch_id),
      seriesId: text(row.series_id),
      promptVersionId: row.prompt_version_id ? text(row.prompt_version_id) : null,
      imageAssetId: text(row.image_asset_id),
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
      sortOrder: Number(row.sort_order),
      relationshipKind: (text(row.relationship_kind) as ImportedCreationOutputDto['relationshipKind']) || 'UNSPECIFIED',
      relationshipTargetOutputId: row.relationship_target_output_id ? text(row.relationship_target_output_id) : null,
      codexTask: row.codex_thread_id
        ? {
            threadId: text(row.codex_thread_id),
            threadName: text(row.codex_thread_name) || `Codex ${text(row.codex_thread_id).slice(0, 8)}`,
          }
        : null,
      createdAt: text(row.created_at),
      asset: {
        id: text(row.image_asset_id),
        kind: text(row.kind) as AssetDto['kind'],
        originType: text(row.origin_type),
        width: Number(row.width),
        height: Number(row.height),
        mimeType: text(row.mime_type),
        byteSize: Number(row.byte_size),
        mediaUrl: mediaUrl(text(row.image_asset_id)),
        createdAt: text(row.asset_created_at),
      },
    };
  }

  private assetDto(assetId: string): AssetDto {
    const row = this.db
      .prepare(
        `SELECT * FROM image_assets
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(assetId) as JsonMap | undefined;
    if (!row) throw new Error('Image asset not found');
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
}
