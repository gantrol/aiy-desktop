import type { ImportedImageMetadataInput, ImportedImageRelationshipInput } from '@/shared/contracts';
import type { IntakeCommitOptions } from '@/renderer/features/intake/useIntakeController';
import type { LocalIntakeItem } from '@/renderer/features/intake/intake-state';

export interface IntakeImageMetadataDraft extends ImportedImageMetadataInput {
  seriesId: string | null;
  promptVersionId: string | null;
}

export type IntakeImageMetadataDraftUpdate = Partial<IntakeImageMetadataDraft>;

export function isAiGeneratedStatus(value: string): value is ImportedImageMetadataInput['aiGeneratedStatus'] {
  return value === 'YES' || value === 'NO' || value === 'UNKNOWN' || value === 'OTHER';
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

export function mergeIntakeImageMetadataDraft(
  draft: IntakeImageMetadataDraft,
  update: IntakeImageMetadataDraftUpdate,
): IntakeImageMetadataDraft {
  let next = { ...draft, ...update };
  if (update.seriesId !== undefined && update.seriesId !== draft.seriesId && update.promptVersionId === undefined) {
    next.promptVersionId = null;
  }
  if (update.modelName?.trim() && next.aiGeneratedStatus === 'UNKNOWN') {
    next = { ...next, aiGeneratedStatus: 'YES' };
  }
  if (next.aiGeneratedStatus === 'NO') {
    next = { ...next, modelName: '', modelProvider: '', modelVersion: '' };
  }
  if (!next.seriesId) next.promptVersionId = null;
  return next;
}

export function applyIntakeBatchFields(
  target: IntakeImageMetadataDraft,
  source: IntakeImageMetadataDraft,
  fields: ReadonlySet<BatchMetadataField>,
) {
  let next = { ...target };
  if (fields.has('displayName')) next.displayName = source.displayName;
  if (fields.has('sourceUrl')) next.sourceUrl = source.sourceUrl;
  if (fields.has('note')) next.note = source.note;
  if (fields.has('aiGeneratedStatus')) next = updateAiGeneratedStatus(next, source.aiGeneratedStatus);
  if (fields.has('modelName')) {
    next.modelName = source.modelName;
    if (source.modelName.trim() && next.aiGeneratedStatus === 'UNKNOWN') {
      next = updateAiGeneratedStatus(next, 'YES');
      next.modelName = source.modelName;
    }
  }
  if (fields.has('modelProvider')) next.modelProvider = source.modelProvider;
  if (fields.has('modelVersion')) next.modelVersion = source.modelVersion;
  if (fields.has('generationText')) {
    next.generationText = source.generationText;
    next.generationTextType = source.generationTextType;
  }
  if (fields.has('seriesId')) {
    const changedSeries = next.seriesId !== source.seriesId;
    next.seriesId = source.seriesId;
    if (changedSeries && !fields.has('promptVersionId')) next.promptVersionId = null;
  }
  if (fields.has('promptVersionId')) {
    next.promptVersionId = next.seriesId === source.seriesId ? source.promptVersionId : null;
  }
  if (next.aiGeneratedStatus === 'NO') {
    next.modelName = '';
    next.modelProvider = '';
    next.modelVersion = '';
  }
  if (!next.seriesId) next.promptVersionId = null;
  return next;
}

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
      const metadata = imageMetadataFromDraft(draft);
      const relationship: ImportedImageRelationshipInput | null = draft.seriesId
        ? { seriesId: draft.seriesId, promptVersionId: draft.promptVersionId }
        : null;
      return [id, { metadata, relationship }];
    }),
  );
}

export function imageMetadataFromDraft(draft: IntakeImageMetadataDraft): ImportedImageMetadataInput {
  return {
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
