import type { BootstrapDto } from '@/shared/contracts';
import type { CreatorLocation, VideoDocumentsLocation } from '@/renderer/components/app/app-navigation';
import type { AiActivityRecord } from '@/renderer/features/ai-center/activityProjection';

export type AiActivityNavigationTarget =
  { view: 'creator'; location: CreatorLocation } | { view: 'documents'; location: VideoDocumentsLocation };

export function aiActivityNavigationTarget(
  record: AiActivityRecord,
  data: Pick<BootstrapDto, 'creationDraft'> | null,
): AiActivityNavigationTarget | null {
  if (record.kind === 'ARTICLE_CHECK') {
    return { view: 'creator', location: { surface: 'article', articleId: record.run.articleId } };
  }
  if (record.kind === 'VIDEO_DOCUMENT') {
    return {
      view: 'documents',
      location: {
        collection: record.activity.albumId ? { kind: 'album', albumId: record.activity.albumId } : { kind: 'unfiled' },
        documentId: record.activity.run.documentId,
      },
    };
  }
  if (record.kind === 'ASSISTANT' && record.run.creationId) {
    return { view: 'creator', location: { surface: 'idea-creation', creationId: record.run.creationId } };
  }
  if (record.kind === 'EXPERIMENT' && record.sourceRun?.creationId) {
    return { view: 'creator', location: { surface: 'idea-creation', creationId: record.sourceRun.creationId } };
  }
  if (record.sourceSeries) {
    const assetId = record.kind === 'GENERATION' ? (record.run.asset?.id ?? null) : null;
    return {
      view: 'creator',
      location: { surface: 'existing-creation', seriesId: record.sourceSeries.id, assetId },
    };
  }
  const scope =
    record.kind === 'ASSISTANT' ? record.run.scope : record.kind === 'EXPERIMENT' ? record.batch.scope : null;
  if (scope?.kind !== 'DRAFT' || data?.creationDraft?.id !== scope.id) return null;
  return {
    view: 'creator',
    location: { surface: 'creation-draft', draftId: data.creationDraft.id },
  };
}
