import { ulid } from 'ulid';
import type {
  CodexTaskReferenceDto,
  CreatorImageImportContext,
  CreatorImageImportItemInput,
  CreatorOutputsImportResult,
  CreatorStagedOutputImportItemInput,
  ImportedCreationOutputDto,
} from '@/shared/contracts';
import { normalizeImportedImageMetadata } from '@/main/database/assets/imported-image-metadata';
import { ensureImageMaterials } from '@/main/database/albums/image-material-batch';
import type { LibraryStorage, StoredObject } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';

interface StoredOutputImage {
  item: Pick<CreatorImageImportItemInput, 'id' | 'name' | 'mimeType' | 'metadata'>;
  stored: StoredObject;
}

interface OutputImportContext {
  seriesId: string;
  promptVersionId: string | null;
  source: CreatorImageImportContext['source'];
  sourceUrl: string;
  exactPrompt: string | null;
  codexTask?: CodexTaskReferenceDto | null;
}

interface InsertCreationOutputBatchInput {
  storage: LibraryStorage;
  context: OutputImportContext;
  staged: { images: StoredOutputImage[]; duplicateCount: number };
  items: readonly CreatorStagedOutputImportItemInput[];
  ensureReferenceAsset(image: StoredOutputImage, source: CreatorImageImportContext['source']): string;
  availableDisplayName(originalName: string, used: Set<string>): string;
  outputDto(outputId: string): ImportedCreationOutputDto;
}

export function insertCreationOutputBatch({
  storage,
  context,
  staged,
  items,
  ensureReferenceAsset,
  availableDisplayName,
  outputDto,
}: InsertCreationOutputBatchInput): CreatorOutputsImportResult {
  if (items.length && items.length !== staged.images.length) {
    throw new Error('Imported output details do not match staged images');
  }
  const db = storage.db;
  const promptVersionIds = new Set<string>();
  for (const [index] of staged.images.entries()) {
    const itemDetails = items[index];
    const promptVersionId = itemDetails ? itemDetails.promptVersionId : context.promptVersionId;
    if (promptVersionId) promptVersionIds.add(promptVersionId);
  }
  for (const promptVersionId of promptVersionIds) {
    const version = db
      .prepare('SELECT 1 FROM prompt_versions WHERE id = ? AND series_id = ?')
      .get(promptVersionId, context.seriesId);
    if (!version) throw new Error('Prompt version does not belong to the selected series');
  }

  const batchId = ulid();
  const createdAt = now();
  const importedOutputs: ImportedCreationOutputDto[] = [];
  const seenAssets = new Set<string>();
  const outputAssetIds = new Set<string>();
  let duplicateCount = staged.duplicateCount;
  const candidates: Array<{
    image: StoredOutputImage;
    itemDetails: CreatorStagedOutputImportItemInput | undefined;
    promptVersionId: string | null;
    imageAssetId: string;
  }> = [];
  for (const [sourceIndex, image] of staged.images.entries()) {
    const itemDetails = items[sourceIndex];
    const promptVersionId = itemDetails ? itemDetails.promptVersionId : context.promptVersionId;
    const imageAssetId = ensureReferenceAsset(image, context.source);
    outputAssetIds.add(imageAssetId);
    const alreadyLinked = db
      .prepare(
        `SELECT 1 FROM creation_output_imports
        WHERE series_id = ? AND image_asset_id = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(context.seriesId, imageAssetId);
    if (seenAssets.has(imageAssetId) || alreadyLinked) {
      duplicateCount += 1;
      continue;
    }
    seenAssets.add(imageAssetId);
    candidates.push({ image, itemDetails, promptVersionId, imageAssetId });
  }

  if (candidates.length) {
    db.prepare(
      `UPDATE creation_output_imports
      SET sort_order = sort_order + ?
      WHERE series_id = ? AND deleted_at IS NULL`,
    ).run(candidates.length, context.seriesId);
  }
  const usedNames = new Set(
    (
      db
        .prepare(
          `SELECT COALESCE(NULLIF(trim(display_name), ''), original_name) AS name
      FROM creation_output_imports WHERE series_id = ? AND deleted_at IS NULL`,
        )
        .all(context.seriesId) as JsonMap[]
    ).map((row) => text(row.name).toLocaleLowerCase()),
  );

  for (const [sortOrder, candidate] of candidates.entries()) {
    const { image, itemDetails, promptVersionId, imageAssetId } = candidate;
    const outputId = ulid();
    const originalName = image.item.name.trim() || 'image';
    const fallbackDisplayName = availableDisplayName(itemDetails?.displayName.trim() || originalName, usedNames);
    const metadata = normalizeImportedImageMetadata(image.item.metadata, {
      displayName: fallbackDisplayName,
      sourceUrl: context.sourceUrl,
      exactPrompt: context.exactPrompt,
    });
    const displayName = itemDetails ? fallbackDisplayName : metadata.displayName;
    usedNames.add(displayName.toLocaleLowerCase());
    db.prepare(
      `INSERT INTO creation_output_imports
        (id, batch_id, series_id, prompt_version_id, image_asset_id, source_type, original_name, created_at, deleted_at,
          display_name, note, source_url, ai_generated_status, model_key, model_name, model_provider,
          model_version, generation_text_type, generation_text, provenance_confidence, comparison_role,
          codex_thread_id, codex_thread_name, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      outputId,
      batchId,
      context.seriesId,
      promptVersionId,
      imageAssetId,
      context.source,
      originalName,
      createdAt,
      displayName,
      metadata.note,
      metadata.sourceUrl,
      metadata.aiGeneratedStatus,
      null,
      metadata.modelName,
      metadata.modelProvider,
      metadata.modelVersion,
      metadata.generationTextType,
      metadata.generationText,
      metadata.provenanceConfidence,
      metadata.comparisonRole,
      context.codexTask?.threadId ?? null,
      context.codexTask?.threadName ?? '',
      sortOrder,
    );
    storage.recordChange('CREATION_OUTPUT_IMPORT', outputId, 'CREATE', {
      batchId,
      seriesId: context.seriesId,
      promptVersionId,
      imageAssetId,
      sourceType: context.source,
      sortOrder,
    });
    importedOutputs.push(outputDto(outputId));
  }

  ensureImageMaterials(storage, [...outputAssetIds]);
  return {
    seriesId: context.seriesId,
    assetIds: importedOutputs.map((output) => output.imageAssetId),
    importedOutputs,
    duplicateCount,
  };
}
