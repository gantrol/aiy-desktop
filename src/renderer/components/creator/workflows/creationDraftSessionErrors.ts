import type { CreationDraftDto } from '@/shared/contracts';

export class CreationDraftSessionSupersededError extends Error {
  constructor(readonly persistedDraft: CreationDraftDto | null = null) {
    super('Creation draft session was superseded');
    this.name = 'CreationDraftSessionSupersededError';
  }
}

export function isCreationDraftSessionSupersededError(reason: unknown): reason is CreationDraftSessionSupersededError {
  return reason instanceof CreationDraftSessionSupersededError;
}
