import type { RecordedLibraryChange } from '@/main/database/core/storage';
import type { ContentReferenceChanges } from '@/shared/contracts/content-reference-changes';

export function contentReferenceChanges(
  spaceId: string,
  changes: readonly RecordedLibraryChange[],
): ContentReferenceChanges | null {
  const ids = new Set<string>();
  for (const change of changes) {
    if (change.entityType === 'ARTICLE') ids.add(change.entityId);
    else if (
      ['ALBUM', 'ALBUM_MEMBER', 'CREATION_ITEM', 'CREATION_FORM', 'IMAGE_ASSET'].includes(change.entityType) &&
      /DELETE|ARCHIVE|RESTORE|PURGE|MOVE/u.test(change.operation)
    )
      return { spaceId, articleIds: null };
    if (ids.size > 256) return { spaceId, articleIds: null };
  }
  return ids.size ? { spaceId, articleIds: [...ids] } : null;
}
