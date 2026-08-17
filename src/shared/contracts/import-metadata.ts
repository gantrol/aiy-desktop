export type ImportedImageAiGeneratedStatus = 'YES' | 'NO' | 'UNKNOWN' | 'OTHER';

export type ImportedImageGenerationTextType = 'EXACT_PROMPT' | 'DESCRIPTION' | 'RECONSTRUCTION' | 'UNKNOWN';

/**
 * User-declared provenance while an image is still in an import review batch.
 * Runtime execution routes are intentionally not accepted at this boundary.
 */
export interface ImportedImageMetadataInput {
  displayName: string;
  note: string;
  sourceUrl: string;
  aiGeneratedStatus: ImportedImageAiGeneratedStatus;
  modelName: string;
  modelProvider: string;
  modelVersion: string;
  generationTextType: ImportedImageGenerationTextType;
  generationText: string;
}

export interface ImportedImageRelationshipInput {
  seriesId: string;
  promptVersionId: string | null;
}
