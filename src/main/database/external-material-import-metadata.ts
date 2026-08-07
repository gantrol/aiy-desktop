import type { ImportedImageMetadataInput } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

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
    modelKey: null,
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
    db.prepare(
      `INSERT OR IGNORE INTO external_material_metadata
      (material_id, original_name, display_name, source_url, updated_at)
      VALUES (?, ?, ?, ?, ?)`,
    ).run(materialId, originalName.trim(), originalName.trim() || 'image', sourceUrl.trim(), now());
    return;
  }

  const existing = db
    .prepare('SELECT display_name FROM external_material_metadata WHERE material_id = ?')
    .get(materialId) as JsonMap | undefined;
  const displayName = metadata.displayName.trim() || originalName.trim() || 'image';
  const hasModel = Boolean(metadata.modelKey || metadata.modelName.trim());
  const aiGeneratedStatus = hasModel && metadata.aiGeneratedStatus === 'UNKNOWN' ? 'YES' : metadata.aiGeneratedStatus;
  const keepGenerationMetadata = aiGeneratedStatus !== 'NO';
  const generationTextType =
    aiGeneratedStatus === 'YES'
      ? metadata.generationTextType === 'UNKNOWN'
        ? 'EXACT_PROMPT'
        : metadata.generationTextType
      : metadata.generationTextType === 'UNKNOWN'
        ? 'DESCRIPTION'
        : metadata.generationTextType;
  const updatedAt = now();
  db.prepare(
    `INSERT INTO external_material_metadata
    (material_id, original_name, display_name, note, source_url, ai_generated_status, model_key,
      model_name, model_provider, model_version, generation_text_type, generation_text,
      provenance_confidence, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DECLARED', ?)
    ON CONFLICT(material_id) DO UPDATE SET
      original_name = excluded.original_name,
      display_name = excluded.display_name,
      note = excluded.note,
      source_url = excluded.source_url,
      ai_generated_status = excluded.ai_generated_status,
      model_key = excluded.model_key,
      model_name = excluded.model_name,
      model_provider = excluded.model_provider,
      model_version = excluded.model_version,
      generation_text_type = excluded.generation_text_type,
      generation_text = excluded.generation_text,
      provenance_confidence = excluded.provenance_confidence,
      updated_at = excluded.updated_at`,
  ).run(
    materialId,
    originalName.trim(),
    displayName,
    metadata.note.trim(),
    metadata.sourceUrl.trim() || sourceUrl.trim(),
    aiGeneratedStatus,
    keepGenerationMetadata ? metadata.modelKey : null,
    keepGenerationMetadata ? metadata.modelName.trim() : '',
    keepGenerationMetadata ? metadata.modelProvider.trim() : '',
    keepGenerationMetadata ? metadata.modelVersion.trim() : '',
    generationTextType,
    metadata.generationText.trim(),
    updatedAt,
  );
  storage.recordChange(
    'EXTERNAL_MATERIAL_METADATA',
    materialId,
    existing ? 'UPDATE' : 'CREATE',
    {},
    { affectsFileView: !existing || displayName !== text(existing.display_name) },
  );
}
