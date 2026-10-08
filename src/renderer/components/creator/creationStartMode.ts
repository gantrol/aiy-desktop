import type { CreationDraftDto } from '@/shared/contracts';
import type { CreationStartMode } from '@/shared/contracts/creation-draft';

export type { CreationStartMode } from '@/shared/contracts/creation-draft';

export function isDocumentCreationStartMode(mode: CreationStartMode | undefined) {
  return mode === 'manuscript' || mode === 'outline';
}

/** Existing drafts without a mode retain their original prompt workspace. */
export function creationStartModeForDraft(draft: CreationDraftDto | null | undefined): CreationStartMode {
  return draft ? (draft.startMode ?? 'image') : 'manuscript';
}
