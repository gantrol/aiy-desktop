import type { BootstrapDto } from '@/shared/contracts';
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

export function useCreatorContentSelection(data: BootstrapDto, location: CreatorLocation) {
  const labels = useI18n().messages.creator.album;
  const index = useCreationWorkIndex(data);
  const locationSelection = useCreatorLocationSelection(
    derivedVisualParentLocation(derivedVisualForLocation(data, location)) ?? location,
  );
  const selectedInspirationStash =
    (data.inspirationStashes ?? []).find((stash) => stash.id === locationSelection.selectedInspirationStashId) ?? null;
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
  const selectedArticle =
    (data.articles ?? []).find((article) => article.id === locationSelection.selectedArticleId) ?? null;
  const selectedArticleForm = selectedArticle
    ? (creationFormByEntity(data.creationItems, 'ARTICLE', selectedArticle.id)?.form ?? null)
    : null;

  return {
    ...locationSelection,
    articleRelations: creationRelationsForForm(data, selectedArticleForm, labels, index),
    selectedAlbum: data.albums.find((album) => album.id === locationSelection.selectedAlbumId) ?? null,
    selectedArticle,
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
