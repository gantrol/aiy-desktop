import type {
  ExternalMaterialMetadataDto,
  ExternalMaterialMetadataUpdateInput,
  MaterialProvenanceSuggestionsDto,
} from '@/shared/contracts';
import {
  findProvenanceModelFamily,
  findProvenanceSourceService,
  isDeprecatedGenericProvenanceSourceName,
  provenanceSourceServiceIdForProvider,
} from '@/shared/provenance-catalog';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { sameImportedModelIdentity } from '@/main/database/assets/imported-image-metadata';
import { z } from 'zod';

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

const snapshotDescriptorSchema = z
  .object({
    internal: z.boolean().optional(),
    modelId: z.string().optional(),
    providerKey: z.string().optional(),
    executionIdentity: z.unknown().optional(),
  })
  .passthrough();

const snapshotExecutionIdentitySchema = z
  .object({
    providerId: z.string(),
    modelId: z.string(),
    canonicalModelFamilyId: z.string().nullable(),
  })
  .passthrough();

function generationSnapshotSuggestions(rows: JsonMap[]) {
  const modelFamilyIds: string[] = [];
  const customModelNames: string[] = [];
  const sourceServiceIds: string[] = [];
  for (const row of rows) {
    let descriptor: z.infer<typeof snapshotDescriptorSchema> | undefined;
    try {
      const parsed = snapshotDescriptorSchema.safeParse(JSON.parse(text(row.descriptor_json)) as unknown);
      if (parsed.success) descriptor = parsed.data;
    } catch {
      // Malformed snapshot descriptors still have model/provider column fallbacks.
    }
    const identityResult = snapshotExecutionIdentitySchema.safeParse(descriptor?.executionIdentity);
    const identity = identityResult.success ? identityResult.data : undefined;
    const providerId = identity?.providerId || descriptor?.providerKey || text(row.provider_key);
    if (descriptor?.internal === true || providerId === 'internal') continue;

    const modelId = identity?.modelId || descriptor?.modelId || text(row.model_id);
    const modelFamily =
      (identity?.canonicalModelFamilyId ? findProvenanceModelFamily(identity.canonicalModelFamilyId) : undefined) ??
      findProvenanceModelFamily(modelId);
    if (modelFamily) modelFamilyIds.push(modelFamily.id);
    else if (modelId && !findProvenanceSourceService(modelId)) customModelNames.push(modelId);

    const sourceServiceId = provenanceSourceServiceIdForProvider(providerId);
    if (sourceServiceId) sourceServiceIds.push(sourceServiceId);
  }
  return {
    modelFamilyIds: uniqueSuggestions(modelFamilyIds),
    customModelNames: uniqueSuggestions(customModelNames),
    sourceServiceIds: uniqueSuggestions(sourceServiceIds),
  };
}

function classifyHistoricalModelNames(values: readonly string[]) {
  const modelFamilyIds: string[] = [];
  const customModelNames: string[] = [];
  for (const value of values) {
    const model = findProvenanceModelFamily(value);
    if (model) modelFamilyIds.push(model.id);
    // Known products, API services, and route/tool aliases are not models.
    else if (!findProvenanceSourceService(value)) customModelNames.push(value);
  }
  return {
    modelFamilyIds: uniqueSuggestions(modelFamilyIds),
    customModelNames: uniqueSuggestions(customModelNames),
  };
}

function classifyHistoricalSourceNames(values: readonly string[]) {
  const sourceServiceIds: string[] = [];
  const customSourceNames: string[] = [];
  for (const value of values) {
    const source = findProvenanceSourceService(value);
    if (source) sourceServiceIds.push(source.id);
    // Known model names accidentally persisted in the source field do not become source choices.
    else if (!findProvenanceModelFamily(value) && !isDeprecatedGenericProvenanceSourceName(value))
      customSourceNames.push(value);
  }
  return {
    sourceServiceIds: uniqueSuggestions(sourceServiceIds),
    customSourceNames: uniqueSuggestions(customSourceNames),
  };
}

export class MaterialMetadataRepository {
  constructor(private readonly storage: LibraryStorage) {}

  update(input: ExternalMaterialMetadataUpdateInput): ExternalMaterialMetadataDto {
    const material = this.storage.db
      .prepare(
        `SELECT material.id, metadata.display_name, metadata.source_url, metadata.model_key,
        metadata.ai_generated_status, metadata.model_name,
        metadata.model_provider, metadata.model_version, metadata.generation_text_type,
        metadata.generation_text, metadata.provenance_confidence
      FROM materials material
      JOIN external_material_metadata metadata ON metadata.material_id = material.id
      WHERE material.id = ? AND material.kind IN ('IMAGE', 'VIDEO') AND material.deleted_at IS NULL`,
      )
      .get(input.materialId) as JsonMap | undefined;
    if (!material) throw new Error('Media material not found');

    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('Material name is required');
    const hasModel = Boolean(input.modelName.trim());
    // Naming a model implies AI generation, but only when the user has not
    // answered the question themselves.
    const aiGeneratedStatus = hasModel && input.aiGeneratedStatus === 'UNKNOWN' ? 'YES' : input.aiGeneratedStatus;
    const modelName = aiGeneratedStatus === 'NO' ? '' : input.modelName.trim();
    const modelProvider = aiGeneratedStatus === 'NO' ? '' : input.modelProvider.trim();
    const modelVersion = aiGeneratedStatus === 'NO' ? '' : input.modelVersion.trim();
    const generationText = input.generationText.trim();
    // `model_key` stores an execution route, not provenance. The editable
    // provenance form may preserve an unchanged route but cannot create one.
    const executionRouteKey =
      aiGeneratedStatus !== 'NO' &&
      sameImportedModelIdentity(
        { modelName, modelProvider, modelVersion },
        {
          modelName: text(material.model_name),
          modelProvider: text(material.model_provider),
          modelVersion: text(material.model_version),
        },
      )
        ? material.model_key
          ? text(material.model_key)
          : null
        : null;
    const provenanceChanged =
      input.sourceUrl.trim() !== text(material.source_url) ||
      aiGeneratedStatus !== text(material.ai_generated_status) ||
      modelName !== text(material.model_name) ||
      modelProvider !== text(material.model_provider) ||
      modelVersion !== text(material.model_version) ||
      input.generationTextType !== text(material.generation_text_type) ||
      generationText !== text(material.generation_text);
    const hasDeclaredProvenance =
      Boolean(input.sourceUrl.trim()) ||
      aiGeneratedStatus !== 'UNKNOWN' ||
      Boolean(modelName || modelProvider || modelVersion || input.generationTextType !== 'UNKNOWN' || generationText);
    const existingConfidence = text(material.provenance_confidence) === 'DECLARED' ? 'DECLARED' : 'UNKNOWN';
    const provenanceConfidence = provenanceChanged
      ? hasDeclaredProvenance
        ? 'DECLARED'
        : 'UNKNOWN'
      : existingConfidence;
    const updatedAt = now();

    this.storage.db
      .prepare(
        `UPDATE external_material_metadata SET
      display_name = ?, note = ?, source_url = ?, ai_generated_status = ?, model_key = ?,
      model_name = ?, model_provider = ?, model_version = ?, generation_text_type = ?,
      generation_text = ?, provenance_confidence = ?, updated_at = ?
      WHERE material_id = ?`,
      )
      .run(
        displayName,
        input.note.trim(),
        input.sourceUrl.trim(),
        aiGeneratedStatus,
        executionRouteKey,
        modelName,
        modelProvider,
        modelVersion,
        input.generationTextType,
        generationText,
        provenanceConfidence,
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

  /** Model family and source service stay free text; catalog identities keep suggestions semantically separated. */
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
    const historicalModels = classifyHistoricalModelNames(column('model_name'));
    const historicalSources = classifyHistoricalSourceNames(column('model_provider'));
    return {
      modelFamilyIds: uniqueSuggestions([...historicalModels.modelFamilyIds, ...snapshots.modelFamilyIds]),
      customModelNames: uniqueSuggestions([...historicalModels.customModelNames, ...snapshots.customModelNames]),
      sourceServiceIds: uniqueSuggestions([...historicalSources.sourceServiceIds, ...snapshots.sourceServiceIds]),
      customSourceNames: historicalSources.customSourceNames,
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
      executionRouteKey: row.model_key ? text(row.model_key) : null,
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
