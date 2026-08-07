export type ImportedImageAiGeneratedStatus = 'YES' | 'NO' | 'UNKNOWN' | 'OTHER';

export type ImportedImageGenerationTextType = 'EXACT_PROMPT' | 'DESCRIPTION' | 'RECONSTRUCTION' | 'UNKNOWN';

/** Metadata declared while an image is still in an import review batch. */
export interface ImportedImageMetadataInput {
  displayName: string;
  note: string;
  sourceUrl: string;
  aiGeneratedStatus: ImportedImageAiGeneratedStatus;
  modelKey: string | null;
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
