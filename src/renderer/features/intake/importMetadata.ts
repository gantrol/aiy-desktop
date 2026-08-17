import type { ImportedImageMetadataInput, ImportedImageRelationshipInput } from '@/shared/contracts';
import type { IntakeCommitOptions } from '@/renderer/features/intake/useIntakeController';
import type { LocalIntakeItem } from '@/renderer/features/intake/intake-state';

export interface IntakeImageMetadataDraft extends ImportedImageMetadataInput {
  seriesId: string | null;
  promptVersionId: string | null;
}

export type IntakeImageDetails = NonNullable<IntakeCommitOptions['imageDetails']>;

export type BatchMetadataField =
  | 'displayName'
  | 'sourceUrl'
  | 'note'
  | 'aiGeneratedStatus'
  | 'modelName'
  | 'modelProvider'
  | 'modelVersion'
  | 'generationText'
  | 'seriesId'
  | 'promptVersionId';

export const defaultBatchMetadataFields = new Set<BatchMetadataField>([
  'aiGeneratedStatus',
  'modelName',
  'modelProvider',
  'generationText',
  'seriesId',
  'promptVersionId',
]);

export function createIntakeImageMetadataDraft(
  item: Exclude<LocalIntakeItem, { kind: 'TEXT' }>,
): IntakeImageMetadataDraft {
  return {
    displayName: item.name.trim() || 'image',
    note: '',
    sourceUrl: item.sourceUrl,
    aiGeneratedStatus: 'UNKNOWN',
    modelName: '',
    modelProvider: '',
    modelVersion: '',
    generationTextType: 'UNKNOWN',
    generationText: '',
    seriesId: null,
    promptVersionId: null,
  };
}

export function imageDetailsFromDrafts(drafts: Readonly<Record<string, IntakeImageMetadataDraft>>): IntakeImageDetails {
  return Object.fromEntries(
    Object.entries(drafts).map(([id, draft]) => {
      const metadata: ImportedImageMetadataInput = {
        displayName: draft.displayName,
        note: draft.note,
        sourceUrl: draft.sourceUrl,
        aiGeneratedStatus: draft.aiGeneratedStatus,
        modelName: draft.modelName,
        modelProvider: draft.modelProvider,
        modelVersion: draft.modelVersion,
        generationTextType: draft.generationTextType,
        generationText: draft.generationText,
      };
      const relationship: ImportedImageRelationshipInput | null = draft.seriesId
        ? { seriesId: draft.seriesId, promptVersionId: draft.promptVersionId }
        : null;
      return [id, { metadata, relationship }];
    }),
  );
}

export function updateAiGeneratedStatus(
  draft: IntakeImageMetadataDraft,
  aiGeneratedStatus: ImportedImageMetadataInput['aiGeneratedStatus'],
): IntakeImageMetadataDraft {
  return {
    ...draft,
    aiGeneratedStatus,
    ...(aiGeneratedStatus === 'NO' ? { modelName: '', modelProvider: '', modelVersion: '' } : {}),
  };
}
