import { ulid } from 'ulid';
import type {
  CreatorImageImportContext,
  ImportedCreationOutputDto,
  ImportedImageMetadataInput,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';
import { normalizeImportedImageMetadata } from '@/main/database/imported-image-metadata';
import { ensureImageMaterials } from '@/main/database/image-material-batch';

export interface ExistingImportedOutputLinkInput {
  batchId: string;
  seriesId: string;
  promptVersionId: string | null;
  imageAssetId: string;
  source: CreatorImageImportContext['source'];
  originalName: string;
  metadata: ImportedImageMetadataInput;
}

export function linkExistingImportedOutput(
  storage: LibraryStorage,
  input: ExistingImportedOutputLinkInput,
  outputDto: (outputId: string) => ImportedCreationOutputDto,
) {
  const db = storage.db;
  const series = db.prepare('SELECT id FROM prompt_series WHERE id = ? AND deleted_at IS NULL').get(input.seriesId) as
    JsonMap | undefined;
  if (!series) throw new Error('Linked creation not found');
  if (
    input.promptVersionId &&
    !db
      .prepare('SELECT 1 FROM prompt_versions WHERE id = ? AND series_id = ?')
      .get(input.promptVersionId, input.seriesId)
  ) {
    throw new Error('Linked Prompt version does not belong to the selected creation');
  }
  const asset = db
    .prepare('SELECT id FROM image_assets WHERE id = ? AND deleted_at IS NULL')
    .get(input.imageAssetId) as JsonMap | undefined;
  if (!asset) throw new Error('Linked image asset not found');

  const normalized = normalizeImportedImageMetadata(input.metadata, {
    displayName: input.originalName.trim() || 'image',
    sourceUrl: input.metadata.sourceUrl.trim(),
    exactPrompt: null,
  });
  const existing = db
    .prepare(
      `SELECT id, display_name FROM creation_output_imports
      WHERE series_id = ? AND image_asset_id = ? AND deleted_at IS NULL
      ORDER BY created_at, id LIMIT 1`,
    )
    .get(input.seriesId, input.imageAssetId) as JsonMap | undefined;
  const outputId = existing ? text(existing.id) : ulid();
  if (existing) {
    db.prepare(
      `UPDATE creation_output_imports SET
      prompt_version_id = ?, display_name = ?, note = ?, source_url = ?, ai_generated_status = ?, model_key = ?,
      model_name = ?, model_provider = ?, model_version = ?, generation_text_type = ?, generation_text = ?,
      provenance_confidence = ?, comparison_role = ?
      WHERE id = ? AND deleted_at IS NULL`,
    ).run(
      input.promptVersionId,
      normalized.displayName,
      normalized.note,
      normalized.sourceUrl,
      normalized.aiGeneratedStatus,
      normalized.modelKey,
      normalized.modelName,
      normalized.modelProvider,
      normalized.modelVersion,
      normalized.generationTextType,
      normalized.generationText,
      normalized.provenanceConfidence,
      normalized.comparisonRole,
      outputId,
    );
    storage.recordChange(
      'CREATION_OUTPUT_IMPORT',
      outputId,
      'UPDATE',
      { seriesId: input.seriesId, promptVersionId: input.promptVersionId },
      { affectsFileView: normalized.displayName !== text(existing.display_name) },
    );
    ensureImageMaterials(storage, [input.imageAssetId]);
    return outputDto(outputId);
  }

  const createdAt = now();
  db.prepare(
    `INSERT INTO creation_output_imports
    (id, batch_id, series_id, prompt_version_id, image_asset_id, source_type, original_name, created_at, deleted_at,
      display_name, note, source_url, ai_generated_status, model_key, model_name, model_provider,
      model_version, generation_text_type, generation_text, provenance_confidence, comparison_role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    outputId,
    input.batchId,
    input.seriesId,
    input.promptVersionId,
    input.imageAssetId,
    input.source,
    input.originalName.trim() || 'image',
    createdAt,
    normalized.displayName,
    normalized.note,
    normalized.sourceUrl,
    normalized.aiGeneratedStatus,
    normalized.modelKey,
    normalized.modelName,
    normalized.modelProvider,
    normalized.modelVersion,
    normalized.generationTextType,
    normalized.generationText,
    normalized.provenanceConfidence,
    normalized.comparisonRole,
  );
  storage.recordChange('CREATION_OUTPUT_IMPORT', outputId, 'CREATE', {
    batchId: input.batchId,
    seriesId: input.seriesId,
    promptVersionId: input.promptVersionId,
    imageAssetId: input.imageAssetId,
    sourceType: input.source,
  });
  ensureImageMaterials(storage, [input.imageAssetId]);
  return outputDto(outputId);
}
