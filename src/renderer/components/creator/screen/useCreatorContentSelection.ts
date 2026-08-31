import type { BootstrapDto, Locale } from '@/shared/contracts';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';
import { creationFormByEntity, creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import { creationRelationsForForm } from '@/renderer/components/creator/screen/creatorScreenProjection';
import { useCreatorLocationSelection } from '@/renderer/components/creator/screen/useCreatorLocationSelection';

export function useCreatorContentSelection(data: BootstrapDto, location: CreatorLocation, locale: Locale) {
  const locationSelection = useCreatorLocationSelection(location);
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
    articleRelations: creationRelationsForForm(data, selectedArticleForm, locale),
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
    socialPostRelations: creationRelationsForForm(data, selectedSocialPostForm, locale),
  };
}
