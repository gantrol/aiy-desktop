import type Database from 'better-sqlite3';
import type {
  CreatorOutputOrganizeItemInput,
  CreatorOutputsOrganizeInput,
  CreatorOutputsOrganizeResult,
  ImportedCreationOutputDto,
} from '@/shared/contracts';
import { sameImportedModelIdentity } from '@/main/database/assets/imported-image-metadata';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';
import { updatedCreationOutputProvenanceConfidence } from '@/main/database/creations/creation-output-provenance';

function validateVersions(db: Database.Database, input: CreatorOutputsOrganizeInput) {
  for (const versionId of new Set(input.items.flatMap((item) => item.promptVersionId ?? []))) {
    const version = db
      .prepare('SELECT 1 FROM prompt_versions WHERE id = ? AND series_id = ?')
      .get(versionId, input.seriesId);
    if (!version) throw new Error('Prompt version does not belong to this creation');
  }
}

function validateRelationships(
  items: readonly CreatorOutputOrganizeItemInput[],
  outputById: ReadonlyMap<string, JsonMap>,
) {
  const relationTargetByOutputId = new Map<string, string>();
  for (const item of items) {
    if (!outputById.has(item.outputId)) throw new Error('Imported output not found');
    if (!item.displayName.trim()) throw new Error('Name is required');
    const requiresTarget =
      item.relationshipKind === 'VARIANT' ||
      item.relationshipKind === 'DERIVED' ||
      item.relationshipKind === 'POST_EDIT';
    if (requiresTarget && !item.relationshipTargetOutputId) {
      throw new Error('The selected output relationship requires another output');
    }
    if (!requiresTarget && item.relationshipTargetOutputId) {
      throw new Error('The selected output relationship cannot have a target');
    }
    if (!item.relationshipTargetOutputId) continue;
    if (item.relationshipTargetOutputId === item.outputId) {
      throw new Error('An output cannot be related to itself');
    }
    if (!outputById.has(item.relationshipTargetOutputId)) {
      throw new Error('Related output does not belong to this creation');
    }
    relationTargetByOutputId.set(item.outputId, item.relationshipTargetOutputId);
  }
  return relationTargetByOutputId;
}

function assertAcyclicRelationships(
  items: readonly CreatorOutputOrganizeItemInput[],
  targets: ReadonlyMap<string, string>,
) {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (outputId: string) => {
    if (visited.has(outputId)) return;
    if (visiting.has(outputId)) throw new Error('Output relationships cannot form a cycle');
    visiting.add(outputId);
    const targetId = targets.get(outputId);
    if (targetId) visit(targetId);
    visiting.delete(outputId);
    visited.add(outputId);
  };
  for (const item of items) visit(item.outputId);
}

function normalizedUpdate(existing: JsonMap, item: CreatorOutputOrganizeItemInput) {
  const displayName = item.displayName.trim();
  const hasModel = Boolean(item.modelName.trim());
  const aiGeneratedStatus = hasModel && item.aiGeneratedStatus === 'UNKNOWN' ? 'YES' : item.aiGeneratedStatus;
  const keepGenerationMetadata = aiGeneratedStatus !== 'NO';
  const modelName = keepGenerationMetadata ? item.modelName.trim() : '';
  const modelProvider = keepGenerationMetadata ? item.modelProvider.trim() : '';
  const modelVersion = keepGenerationMetadata ? text(existing.model_version) : '';
  const comparisonRole = aiGeneratedStatus === 'NO' ? 'ACTUAL' : modelName ? 'MODEL' : 'UNKNOWN';
  const executionRouteKey =
    comparisonRole === 'MODEL' &&
    sameImportedModelIdentity(
      { modelName, modelProvider, modelVersion },
      {
        modelName: text(existing.model_name),
        modelProvider: text(existing.model_provider),
        modelVersion: text(existing.model_version),
      },
    )
      ? existing.model_key
        ? text(existing.model_key)
        : null
      : null;
  const provenanceConfidence = updatedCreationOutputProvenanceConfidence(existing, {
    sourceUrl: text(existing.source_url),
    aiGeneratedStatus,
    comparisonRole,
    modelName,
    modelProvider,
    modelVersion,
    generationTextType: text(existing.generation_text_type) as ImportedCreationOutputDto['generationTextType'],
    generationText: text(existing.generation_text),
  });
  return {
    displayName,
    aiGeneratedStatus,
    executionRouteKey,
    modelName,
    modelProvider,
    modelVersion,
    provenanceConfidence,
    comparisonRole,
  };
}

function activeOutputs(db: Database.Database, input: CreatorOutputsOrganizeInput) {
  const rows = db
    .prepare(
      `SELECT * FROM creation_output_imports
      WHERE series_id = ? AND deleted_at IS NULL
      ORDER BY sort_order, created_at DESC, id DESC`,
    )
    .all(input.seriesId) as JsonMap[];
  const outputById = new Map(rows.map((row) => [text(row.id), row]));
  const submittedIds = new Set(input.items.map((item) => item.outputId));
  if (
    input.items.length !== rows.length ||
    submittedIds.size !== input.items.length ||
    rows.some((row) => !submittedIds.has(text(row.id)))
  ) {
    throw new Error('Imported outputs changed while they were being organized');
  }
  return outputById;
}

export function organizeCreationOutputs(
  storage: LibraryStorage,
  input: CreatorOutputsOrganizeInput,
  outputDto: (outputId: string) => ImportedCreationOutputDto,
): CreatorOutputsOrganizeResult {
  const db = storage.db;
  return db
    .transaction(() => {
      const series = db.prepare('SELECT id FROM prompt_series WHERE id = ? AND deleted_at IS NULL').get(input.seriesId);
      if (!series) throw new Error('Creation not found');
      const outputById = activeOutputs(db, input);
      validateVersions(db, input);
      const relationshipTargets = validateRelationships(input.items, outputById);
      assertAcyclicRelationships(input.items, relationshipTargets);

      const update = db.prepare(
        `UPDATE creation_output_imports SET
          prompt_version_id = ?, display_name = ?, ai_generated_status = ?, model_key = ?, model_name = ?,
          model_provider = ?, model_version = ?, provenance_confidence = ?, comparison_role = ?,
          relationship_kind = ?, relationship_target_output_id = ?, sort_order = ?
        WHERE id = ? AND series_id = ? AND deleted_at IS NULL`,
      );
      for (const [sortOrder, item] of input.items.entries()) {
        const existing = outputById.get(item.outputId)!;
        const next = normalizedUpdate(existing, item);
        const result = update.run(
          item.promptVersionId,
          next.displayName,
          next.aiGeneratedStatus,
          next.executionRouteKey,
          next.modelName,
          next.modelProvider,
          next.modelVersion,
          next.provenanceConfidence,
          next.comparisonRole,
          item.relationshipKind,
          item.relationshipTargetOutputId,
          sortOrder,
          item.outputId,
          input.seriesId,
        );
        if (result.changes !== 1) throw new Error('Imported output changed while it was being organized');
        storage.recordChange(
          'CREATION_OUTPUT_IMPORT',
          item.outputId,
          'ORGANIZE',
          {
            promptVersionId: item.promptVersionId,
            relationshipKind: item.relationshipKind,
            relationshipTargetOutputId: item.relationshipTargetOutputId,
            sortOrder,
          },
          { affectsFileView: next.displayName !== text(existing.display_name) },
        );
      }
      return { outputs: input.items.map((item) => outputDto(item.outputId)) };
    })
    .immediate();
}
