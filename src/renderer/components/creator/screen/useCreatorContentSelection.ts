import type { BootstrapDto } from '@/shared/contracts';
import { useMemo } from 'react';
import { articleDraftDto } from '@/shared/article-draft';
import { useArticleDetails } from '@/renderer/components/creator/useArticleDetails';
import { useWorkspaceVisible } from '@/renderer/components/workspace/WorkspacePaneScope';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useCreationWorkIndex } from '@/renderer/components/creator/useCreationWorkIndex';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';
import { creationFormByEntity, creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import { creationRelationsForForm } from '@/renderer/components/creator/screen/creatorScreenProjection';
import { useCreatorLocationSelection } from '@/renderer/components/creator/screen/useCreatorLocationSelection';
import {
  derivedVisualForLocation,
  derivedVisualParentLocation,
} from '@/renderer/components/creator/derivedVisualWorkspace';

export function useCreatorContentSelection(
  data: BootstrapDto,
  location: CreatorLocation,
  notify: (message: string) => void,
) {
  const active = useWorkspaceVisible();
  const labels = useI18n().messages.creator.album;
  const index = useCreationWorkIndex(data);
  const locationSelection = useCreatorLocationSelection(
    derivedVisualParentLocation(derivedVisualForLocation(data, location)) ?? location,
  );
  const selectedImageBreakdown =
    (data.imageBreakdowns ?? []).find((breakdown) => breakdown.id === locationSelection.selectedImageBreakdownId) ??
    null;
  const selectedImageBreakdownItem = selectedImageBreakdown
    ? creationItemByFormEntity(data.creationItems, 'IMAGE_BREAKDOWN', selectedImageBreakdown.id)
    : null;
  const selectedEvaluationSuite =
    (data.evaluationSuites ?? []).find((suite) => suite.id === locationSelection.selectedEvaluationSuiteId) ?? null;
  const selectedEvaluationSuiteItem = selectedEvaluationSuite
    ? creationItemByFormEntity(data.creationItems, 'EVALUATION_SUITE', selectedEvaluationSuite.id)
    : null;
  const selectedSocialPost =
    (data.socialPosts ?? []).find((post) => post.id === locationSelection.selectedSocialPostId) ?? null;
  const selectedSocialPostForm = selectedSocialPost
    ? (creationFormByEntity(data.creationItems, 'SOCIAL_POST', selectedSocialPost.id)?.form ?? null)
    : null;
  const articleSummary =
    (data.articles ?? []).find(
      (article) => article.id === (locationSelection.selectedArticleId ?? locationSelection.selectedInspirationStashId),
    ) ?? null;
  const details = useArticleDetails(data.spaceId, articleSummary, active, notify);
  const selectedArticle = locationSelection.selectedArticleId ? details.article : null;
  const selectedInspirationStash = useMemo(() => {
    const id = locationSelection.selectedInspirationStashId;
    if (!id) return null;
    return (
      (data.inspirationStashes ?? []).find((stash) => stash.id === id) ??
      (details.article?.id === id ? articleDraftDto(details.article) : null)
    );
  }, [data.inspirationStashes, locationSelection.selectedInspirationStashId, details.article]);
  const selectedArticleForm = selectedArticle
    ? (creationFormByEntity(data.creationItems, 'ARTICLE', selectedArticle.id)?.form ?? null)
    : null;

  return {
    ...locationSelection,
    articleRelations: creationRelationsForForm(data, selectedArticleForm, labels, index),
    selectedAlbum: data.albums.find((album) => album.id === locationSelection.selectedAlbumId) ?? null,
    selectedArticle,
    articleLoadError: details.error,
    retryArticleLoad: details.retry,
    selectedArticleForm,
    selectedEvaluationSuite,
    selectedEvaluationSuiteItem,
    selectedIdeaCreation:
      (data.creations ?? []).find((creation) => creation.id === locationSelection.selectedIdeaCreationId) ?? null,
    selectedImageBreakdown,
    selectedImageBreakdownItem,
    selectedInspirationStash,
    selectedSocialPost,
    selectedSocialPostForm,
    socialPostRelations: creationRelationsForForm(data, selectedSocialPostForm, labels, index),
  };
}
