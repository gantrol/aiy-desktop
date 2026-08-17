import type { ImportedImageMetadataInput } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now } from '@/main/database/core/values';

interface ImportedMaterialMetadataWriteInput {
  materialId: string;
  originalName: string;
  sourceUrl: string;
  metadata?: ImportedImageMetadataInput;
}

export function defaultImportedImageMetadata(originalName: string, sourceUrl: string): ImportedImageMetadataInput {
  return {
    displayName: originalName.trim() || 'image',
    note: '',
    sourceUrl: sourceUrl.trim(),
    aiGeneratedStatus: 'UNKNOWN',
    modelName: '',
    modelProvider: '',
    modelVersion: '',
    generationTextType: 'UNKNOWN',
    generationText: '',
  };
}

export function writeImportedMaterialMetadata(
  storage: LibraryStorage,
  { materialId, originalName, sourceUrl, metadata }: ImportedMaterialMetadataWriteInput,
) {
  const db = storage.db;
  if (!metadata) {
    const normalizedSourceUrl = sourceUrl.trim();
    db.prepare(
      `INSERT OR IGNORE INTO external_material_metadata
      (material_id, original_name, display_name, source_url, provenance_confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      materialId,
      originalName.trim(),
      originalName.trim() || 'image',
      normalizedSourceUrl,
      normalizedSourceUrl ? 'DECLARED' : 'UNKNOWN',
      now(),
    );
    return;
  }

  // Re-importing identical bytes reuses the existing asset and material. The
  // review form describes this import attempt; it is not authorization to
  // replace metadata already curated for that material.
  if (db.prepare('SELECT 1 FROM external_material_metadata WHERE material_id = ?').get(materialId)) return;

  const displayName = metadata.displayName.trim() || originalName.trim() || 'image';
  const hasModel = Boolean(metadata.modelName.trim());
  const aiGeneratedStatus = hasModel && metadata.aiGeneratedStatus === 'UNKNOWN' ? 'YES' : metadata.aiGeneratedStatus;
  const keepGenerationMetadata = aiGeneratedStatus !== 'NO';
  const normalizedSourceUrl = metadata.sourceUrl.trim() || sourceUrl.trim();
  const hasDeclaredProvenance =
    Boolean(normalizedSourceUrl) ||
    aiGeneratedStatus !== 'UNKNOWN' ||
    Boolean(
      metadata.modelName.trim() ||
      metadata.modelProvider.trim() ||
      metadata.modelVersion.trim() ||
      metadata.generationTextType !== 'UNKNOWN' ||
      metadata.generationText.trim(),
    );
  const updatedAt = now();
  db.prepare(
    `INSERT INTO external_material_metadata
    (material_id, original_name, display_name, note, source_url, ai_generated_status, model_key,
      model_name, model_provider, model_version, generation_text_type, generation_text,
      provenance_confidence, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    materialId,
    originalName.trim(),
    displayName,
    metadata.note.trim(),
    normalizedSourceUrl,
    aiGeneratedStatus,
    keepGenerationMetadata ? metadata.modelName.trim() : '',
    keepGenerationMetadata ? metadata.modelProvider.trim() : '',
    keepGenerationMetadata ? metadata.modelVersion.trim() : '',
    metadata.generationTextType,
    metadata.generationText.trim(),
    hasDeclaredProvenance ? 'DECLARED' : 'UNKNOWN',
    updatedAt,
  );
  storage.recordChange('EXTERNAL_MATERIAL_METADATA', materialId, 'CREATE', {}, { affectsFileView: true });
}
