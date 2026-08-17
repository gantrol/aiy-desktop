import type { ImportedCreationOutputDto, ImportedImageMetadataInput } from '@/shared/contracts';

export interface NormalizedImportedImageMetadata {
  displayName: string;
  note: string;
  sourceUrl: string;
  aiGeneratedStatus: ImportedCreationOutputDto['aiGeneratedStatus'];
  comparisonRole: ImportedCreationOutputDto['comparisonRole'];
  modelName: string;
  modelProvider: string;
  modelVersion: string;
  generationTextType: ImportedCreationOutputDto['generationTextType'];
  generationText: string;
  provenanceConfidence: ImportedCreationOutputDto['provenanceConfidence'];
}

function normalizedAiStatus(metadata: ImportedImageMetadataInput | undefined, hasModel: boolean) {
  const requested = metadata?.aiGeneratedStatus ?? 'UNKNOWN';
  return hasModel && requested === 'UNKNOWN' ? 'YES' : requested;
}

function hasDeclaredData(
  metadata: ImportedImageMetadataInput | undefined,
  normalized: Omit<NormalizedImportedImageMetadata, 'provenanceConfidence'>,
  exactPrompt: string | null,
) {
  if (exactPrompt !== null || normalized.sourceUrl) return true;
  if (!metadata) return false;
  return (
    normalized.aiGeneratedStatus !== 'UNKNOWN' ||
    normalized.comparisonRole !== 'UNKNOWN' ||
    Boolean(
      normalized.modelName ||
      normalized.modelProvider ||
      normalized.modelVersion ||
      normalized.generationTextType !== 'UNKNOWN' ||
      normalized.generationText,
    )
  );
}

export function normalizeImportedImageMetadata(
  metadata: ImportedImageMetadataInput | undefined,
  defaults: { displayName: string; sourceUrl: string; exactPrompt: string | null },
): NormalizedImportedImageMetadata {
  const modelName = metadata?.modelName.trim() ?? '';
  const modelProvider = metadata?.modelProvider.trim() ?? '';
  const modelVersion = metadata?.modelVersion.trim() ?? '';
  const hasModel = Boolean(modelName);
  const aiGeneratedStatus = normalizedAiStatus(metadata, hasModel);
  const comparisonRole = aiGeneratedStatus === 'NO' ? 'ACTUAL' : hasModel ? 'MODEL' : 'UNKNOWN';
  const keepGenerationMetadata = aiGeneratedStatus !== 'NO';
  const normalized = {
    displayName: metadata?.displayName.trim() || defaults.displayName,
    note: metadata?.note.trim() ?? '',
    sourceUrl: metadata?.sourceUrl.trim() || defaults.sourceUrl,
    aiGeneratedStatus,
    comparisonRole,
    modelName: keepGenerationMetadata ? modelName : '',
    modelProvider: keepGenerationMetadata ? modelProvider : '',
    modelVersion: keepGenerationMetadata ? modelVersion : '',
    generationTextType: metadata?.generationTextType ?? (defaults.exactPrompt === null ? 'UNKNOWN' : 'EXACT_PROMPT'),
    generationText: metadata?.generationText.trim() ?? defaults.exactPrompt ?? '',
  } satisfies Omit<NormalizedImportedImageMetadata, 'provenanceConfidence'>;
  return {
    ...normalized,
    provenanceConfidence: hasDeclaredData(metadata, normalized, defaults.exactPrompt) ? 'DECLARED' : 'UNKNOWN',
  };
}

interface ImportedModelIdentity {
  modelName: string;
  modelProvider: string;
  modelVersion: string;
}

/** An execution route remains valid only while its complete recorded source identity is unchanged. */
export function sameImportedModelIdentity(left: ImportedModelIdentity, right: ImportedModelIdentity) {
  return (
    left.modelName.trim() === right.modelName.trim() &&
    left.modelProvider.trim() === right.modelProvider.trim() &&
    left.modelVersion.trim() === right.modelVersion.trim()
  );
}
