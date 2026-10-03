import type { ContentLookupResult } from '@/shared/contracts/content-search';

// Authored sample content is stable across interface languages and has no real library IDs.
export const sampleQuery = '教程';
export const searchItems: ContentLookupResult['items'] = [
  ['tutorial-outline', '教程大纲', '从一个问题开始，逐步整理操作步骤和引用。'],
  ['tutorial-images', '教程配图', '用截图说明操作位置，并保留图片出处。'],
  ['tutorial-feedback', '教程反馈', '记录读者遇到的困难，作为下一次修改的输入。'],
].map(([id, title, preview]) => ({
  source: { kind: 'ARTICLE', id: `component-lab-${id}` },
  title,
  preview,
  bodyIndexed: true,
  updatedAt: '2026-10-01T12:00:00Z',
  branchRole: null,
  match: 'TITLE',
}));

export function searchResult(items: ContentLookupResult['items']): ContentLookupResult {
  return {
    scope: 'CURRENT_SAVED_DOCUMENTS',
    snapshot: 'component-lab',
    reset: false,
    coverage: { total: 3, ready: 3, pending: 0, unavailable: 0, limited: 0 },
    items,
    nextOffset: null,
  };
}
