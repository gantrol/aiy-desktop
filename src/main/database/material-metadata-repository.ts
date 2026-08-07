import type {
  ExternalMaterialMetadataDto,
  ExternalMaterialMetadataUpdateInput,
  MaterialProvenanceSuggestionsDto,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

function uniqueSuggestions(values: readonly string[]) {
  const seen = new Set<string>();
  return values.flatMap((rawValue) => {
    const value = rawValue.trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

function generationSnapshotSuggestions(rows: JsonMap[]) {
  const modelNames: string[] = [];
  const modelProviders: string[] = [];
  for (const row of rows) {
    let descriptor: JsonMap = {};
    try {
      const parsed = JSON.parse(text(row.descriptor_json)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) descriptor = parsed as JsonMap;
    } catch {
      // Malformed snapshot descriptors still have model/provider column fallbacks.
    }
    if (descriptor.internal === true) continue;
    modelNames.push(text(descriptor.name) || text(row.model_id));
    modelProviders.push(text(descriptor.provider) || text(row.provider_key));
  }
  return { modelNames: uniqueSuggestions(modelNames), modelProviders: uniqueSuggestions(modelProviders) };
}

export class MaterialMetadataRepository {
  constructor(private readonly storage: LibraryStorage) {}

  update(input: ExternalMaterialMetadataUpdateInput): ExternalMaterialMetadataDto {
    const material = this.storage.db
      .prepare(
        `SELECT material.id, metadata.display_name
      FROM materials material
      JOIN external_material_metadata metadata ON metadata.material_id = material.id
      WHERE material.id = ? AND material.kind = 'IMAGE' AND material.deleted_at IS NULL`,
      )
      .get(input.materialId) as JsonMap | undefined;
    if (!material) throw new Error('Image material not found');

    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('Material name is required');
    const hasModel = Boolean(input.modelKey || input.modelName.trim());
    // Naming a model implies AI generation, but only when the user has not
    // answered the question themselves.
    const aiGeneratedStatus = hasModel && input.aiGeneratedStatus === 'UNKNOWN' ? 'YES' : input.aiGeneratedStatus;
    const modelKey = aiGeneratedStatus === 'NO' ? null : input.modelKey;
    const modelName = aiGeneratedStatus === 'NO' ? '' : input.modelName.trim();
    const modelProvider = aiGeneratedStatus === 'NO' ? '' : input.modelProvider.trim();
    const modelVersion = aiGeneratedStatus === 'NO' ? '' : input.modelVersion.trim();
    const generationTextType =
      aiGeneratedStatus === 'YES'
        ? input.generationTextType === 'UNKNOWN'
          ? 'EXACT_PROMPT'
          : input.generationTextType
        : input.generationTextType === 'UNKNOWN'
          ? 'DESCRIPTION'
          : input.generationTextType;
    const updatedAt = now();

    this.storage.db
      .prepare(
        `UPDATE external_material_metadata SET
      display_name = ?, note = ?, source_url = ?, ai_generated_status = ?, model_key = ?,
      model_name = ?, model_provider = ?, model_version = ?, generation_text_type = ?,
      generation_text = ?, provenance_confidence = 'DECLARED', updated_at = ?
      WHERE material_id = ?`,
      )
      .run(
        displayName,
        input.note.trim(),
        input.sourceUrl.trim(),
        aiGeneratedStatus,
        modelKey,
        modelName,
        modelProvider,
        modelVersion,
        generationTextType,
        input.generationText.trim(),
        updatedAt,
        input.materialId,
      );
    this.storage.recordChange(
      'EXTERNAL_MATERIAL_METADATA',
      input.materialId,
      'UPDATE',
      {},
      { affectsFileView: displayName !== text(material.display_name) },
    );
    return this.get(input.materialId);
  }

  /** Model and platform stay free text; persisted facts only seed suggestions. */
  suggestions(): MaterialProvenanceSuggestionsDto {
    const column = (name: 'model_name' | 'model_provider') =>
      (
        this.storage.db
          .prepare(
            `SELECT value FROM (
              SELECT TRIM(${name}) AS value FROM external_material_metadata
              WHERE TRIM(${name}) <> ''
              UNION
              SELECT TRIM(${name}) AS value FROM creation_output_imports
              WHERE deleted_at IS NULL AND TRIM(${name}) <> ''
            )
            ORDER BY value COLLATE NOCASE LIMIT 200`,
          )
          .all() as JsonMap[]
      ).map((row) => text(row.value));
    const snapshots = generationSnapshotSuggestions(
      this.storage.db
        .prepare(
          `SELECT descriptor_json, model_id, provider_key
          FROM generation_model_snapshots
          GROUP BY descriptor_json, model_id, provider_key
          ORDER BY MAX(created_at) DESC
          LIMIT 200`,
        )
        .all() as JsonMap[],
    );
    return {
      modelNames: uniqueSuggestions([...column('model_name'), ...snapshots.modelNames]),
      modelProviders: uniqueSuggestions([...column('model_provider'), ...snapshots.modelProviders]),
    };
  }

  get(materialId: string): ExternalMaterialMetadataDto {
    const row = this.storage.db
      .prepare('SELECT * FROM external_material_metadata WHERE material_id = ?')
      .get(materialId) as JsonMap | undefined;
    if (!row) throw new Error('Material metadata not found');
    return {
      materialId: text(row.material_id),
      originalName: text(row.original_name),
      displayName: text(row.display_name),
      note: text(row.note),
      sourceUrl: text(row.source_url),
      aiGeneratedStatus: text(row.ai_generated_status) as ExternalMaterialMetadataDto['aiGeneratedStatus'],
      modelKey: row.model_key ? text(row.model_key) : null,
      modelName: text(row.model_name),
      modelProvider: text(row.model_provider),
      modelVersion: text(row.model_version),
      generationTextType: text(row.generation_text_type) as ExternalMaterialMetadataDto['generationTextType'],
      generationText: text(row.generation_text),
      provenanceConfidence: text(row.provenance_confidence) as ExternalMaterialMetadataDto['provenanceConfidence'],
      updatedAt: text(row.updated_at),
    };
  }
}
