import type { LibraryStorage } from '@/main/database/core/storage';
import { now } from '@/main/database/core/values';
import { savedCreationDraftScope } from '@/main/database/creations/creation-draft-list';
import type { CreationDraftDeleteInput, CreationDraftDeletion } from '@/shared/contracts/creation-draft-deletion';

export function deleteCreationDrafts(storage: LibraryStorage, input: CreationDraftDeleteInput): CreationDraftDeletion {
  return storage.db.transaction(() => {
    const deletedAt = now();
    // Share the list's scope so clearing never touches consumed inputs or derived-visual workspaces.
    const rows = storage.db
      .prepare(
        `UPDATE creation_drafts SET deleted_at = @deletedAt
        WHERE id IN (SELECT draft.id ${savedCreationDraftScope}
          AND (@draftId IS NULL OR draft.id = @draftId)) RETURNING id`,
      )
      .all({ deletedAt, draftId: input.draftId }) as { id: string }[];
    for (const { id } of rows) {
      storage.recordChange('CREATION_DRAFT', id, 'DELETE', {}, { affectsFileView: false });
    }
    return { spaceId: input.spaceId, draftIds: rows.map(({ id }) => id), deletedAt };
  })();
}

export function restoreCreationDrafts(storage: LibraryStorage, deletion: CreationDraftDeletion): void {
  storage.db.transaction(() => {
    // Match the exact deletion, so an old undo cannot resurrect a subsequently deleted or consumed draft.
    const rows = storage.db
      .prepare(
        `UPDATE creation_drafts SET deleted_at = NULL
        WHERE id IN (SELECT value FROM json_each(@draftIds))
          AND deleted_at = @deletedAt AND consumed_at IS NULL RETURNING id`,
      )
      .all({ draftIds: JSON.stringify(deletion.draftIds), deletedAt: deletion.deletedAt }) as { id: string }[];
    for (const { id } of rows) {
      storage.recordChange('CREATION_DRAFT', id, 'RESTORE', {}, { affectsFileView: false });
    }
  })();
}
