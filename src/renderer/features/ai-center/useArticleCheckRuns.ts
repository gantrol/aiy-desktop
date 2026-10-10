import type { ArticleCheckRunDto } from '@/shared/contracts';
import { useActivityHistory } from '@/renderer/features/ai-center/useActivityHistory';

const source = {
  page: (cursor: string | null) => window.desktopApi.articleCheckRunsList({ cursor, limit: 200 }),
  key: (item: ArticleCheckRunDto) => item.id,
  compare: (left: ArticleCheckRunDto, right: ArticleCheckRunDto) =>
    right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id),
  live: (item: ArticleCheckRunDto) => item.status === 'RUNNING',
};
export function useArticleCheckRuns(active: boolean, notify: (message: string) => void, all = false) {
  return useActivityHistory(active, source, notify, all);
}
