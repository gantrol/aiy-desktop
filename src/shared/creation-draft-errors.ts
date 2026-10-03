export const CREATION_DRAFT_CONFLICT = 'CREATION_DRAFT_CONFLICT';

/** Electron preserves the message, but not custom error properties, across invoke. */
export function isCreationDraftConflict(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.includes(CREATION_DRAFT_CONFLICT);
}
