import type { LibraryDatabase } from '@/main/database';
import type { CreationDraftsChanged } from '@/shared/contracts/creation-draft-list';
import type { ContentReferenceChanges } from '@/shared/contracts/content-reference-changes';
import { contentReferenceChanges } from '@/main/creations/content-reference-changes';

export function subscribeCreatorChanges(
  database: Pick<LibraryDatabase, 'subscribeContentChanges'>,
  spaceId: string,
  events: {
    creationDraftsChanged(event: CreationDraftsChanged): void;
    contentReferencesChanged(event: ContentReferenceChanges): void;
  },
) {
  return database.subscribeContentChanges((changes) => {
    const references = contentReferenceChanges(spaceId, changes);
    if (references) events.contentReferencesChanged(references);
    if (changes.some((change) => ['CREATION_DRAFT', 'DERIVED_VISUAL'].includes(change.entityType))) {
      events.creationDraftsChanged({ spaceId });
    }
  });
}
