import type { ContentSource } from '@/shared/contracts/content-source';

export function contentSearchSourceKey(source: ContentSource) {
  return JSON.stringify([source.kind, source.id, source.branchId]);
}
