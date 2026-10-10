import type { ContentLookupResult } from '@/shared/contracts/content-search';
import type { ImageSearchItem } from '@/shared/contracts/image-search';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';

export type WorkspaceSearchItem = ContentLookupResult['items'][number] | ImageSearchItem;
export function workspaceSearchItemKey(item: WorkspaceSearchItem) {
  return 'source' in item ? contentSearchSourceKey(item.source) : `IMAGE:${item.id}`;
}
