import type { ImportedCreationOutputDto } from '@/shared/contracts';
import { type JsonMap, text } from '@/main/database/core/values';

type ImportedOutputProvenance = Pick<
  ImportedCreationOutputDto,
  | 'sourceUrl'
  | 'aiGeneratedStatus'
  | 'comparisonRole'
  | 'modelName'
  | 'modelProvider'
  | 'modelVersion'
  | 'generationTextType'
  | 'generationText'
>;

export function updatedCreationOutputProvenanceConfidence(
  existing: JsonMap,
  next: ImportedOutputProvenance,
  override?: ImportedCreationOutputDto['provenanceConfidence'],
) {
  if (override) return override;
  const changed = [
    next.sourceUrl !== text(existing.source_url),
    next.aiGeneratedStatus !== text(existing.ai_generated_status),
    next.comparisonRole !== text(existing.comparison_role),
    next.modelName !== text(existing.model_name),
    next.modelProvider !== text(existing.model_provider),
    next.modelVersion !== text(existing.model_version),
    next.generationTextType !== text(existing.generation_text_type),
    next.generationText !== text(existing.generation_text),
  ].some(Boolean);
  if (!changed) {
    return text(existing.provenance_confidence) as ImportedCreationOutputDto['provenanceConfidence'];
  }
  const hasDeclaredProvenance = [
    next.sourceUrl,
    next.aiGeneratedStatus === 'UNKNOWN' ? '' : next.aiGeneratedStatus,
    next.comparisonRole === 'UNKNOWN' ? '' : next.comparisonRole,
    next.modelName,
    next.modelProvider,
    next.modelVersion,
    next.generationTextType === 'UNKNOWN' ? '' : next.generationTextType,
    next.generationText,
  ].some(Boolean);
  return hasDeclaredProvenance ? 'DECLARED' : 'UNKNOWN';
}
