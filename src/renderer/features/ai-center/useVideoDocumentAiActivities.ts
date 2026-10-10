import type { VideoDocumentAiActivityDto } from '@/shared/contracts/video-document-ai-activity';
import { useActivityHistory } from '@/renderer/features/ai-center/useActivityHistory';

const key = (item: VideoDocumentAiActivityDto) => `${item.type}:${item.run.id}`;
const source = {
  page: (cursor: string | null) => window.desktopApi.videoDocumentAiActivitiesList({ cursor, limit: 200 }),
  key,
  compare: (left: VideoDocumentAiActivityDto, right: VideoDocumentAiActivityDto) =>
    right.run.startedAt.localeCompare(left.run.startedAt) || key(right).localeCompare(key(left)),
  live: (item: VideoDocumentAiActivityDto) => item.run.status === 'RUNNING' || item.run.status === 'NOT_STARTED',
};
export function useVideoDocumentAiActivities(active: boolean, notify: (message: string) => void, all = false) {
  return useActivityHistory(active, source, notify, all);
}
