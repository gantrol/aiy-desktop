import type { AssistantRunDto, BootstrapDto, CreationDraftDto } from '@/shared/contracts';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';
import { creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import {
  derivedVisualForLocation,
  derivedVisualWorkspaceVersion,
} from '@/renderer/components/creator/derivedVisualWorkspace';
import { allAssets } from '@/renderer/components/creator/utils';
import {
  defaultDerivedDraftParentLocation,
  defaultStandaloneCreationDraft,
  defaultStandaloneCreationSeriesId,
  imageSeriesIdForCreationItem,
} from '@/renderer/components/creator/screen/creatorScreenProjection';

export type CreatorCreationMode = 'existing' | 'new';

export interface CreatorInitialSession {
  derivedDraftParentLocation: CreatorLocation | null;
  initialAssistantRun: AssistantRunDto | null;
  initialCreationMode: CreatorCreationMode;
  initialDraft: CreationDraftDto | null;
  initialInspirationItemAlbumId: string | null;
  initialInspirationStashAlbumId: string | null;
  initialSeriesId: string | null;
}

function resolveCreationMode(input: {
  location: CreatorLocation;
  resumableDerivedSeriesId: string | null;
  hasInitialContent: boolean;
  hasInspiration: boolean;
  inspirationSeriesId: string | null;
  hasStandaloneDraft: boolean;
  standaloneSeriesId: string | null;
}): CreatorCreationMode {
  if (input.location.surface === 'new-creation' || input.location.surface === 'creation-draft') return 'new';
  if (input.location.surface === 'existing-creation' || input.resumableDerivedSeriesId) return 'existing';
  if (input.hasInitialContent) return 'new';
  if (input.hasInspiration) return input.inspirationSeriesId ? 'existing' : 'new';
  if (input.hasStandaloneDraft) return 'new';
  return input.standaloneSeriesId ? 'existing' : 'new';
}

function resolveInitialSeriesId(input: {
  location: CreatorLocation;
  resumableDerivedSeriesId: string | null;
  hasInitialContent: boolean;
  inspirationSeriesId: string | null;
  hasDraft: boolean;
  standaloneSeriesId: string | null;
}) {
  if (input.resumableDerivedSeriesId) return input.resumableDerivedSeriesId;
  if (input.hasInitialContent) return null;
  if (input.location.surface === 'new-creation' || input.location.surface === 'creation-draft') return null;
  if (input.location.surface === 'existing-creation') return input.location.seriesId;
  if (input.inspirationSeriesId) return input.inspirationSeriesId;
  return input.hasDraft ? null : input.standaloneSeriesId;
}

function activeAssistantRun(
  data: BootstrapDto,
  mode: CreatorCreationMode,
  draft: CreationDraftDto | null,
  seriesId: string | null,
) {
  return (
    data.assistantRuns.find(
      (run) =>
        !run.dismissedAt &&
        run.proposal?.status !== 'CLOSED' &&
        (mode === 'new'
          ? run.scope.kind === 'DRAFT' && run.scope.id === draft?.id
          : run.scope.kind === 'SERIES' && run.scope.id === seriesId),
    ) ?? null
  );
}

function savedDerivedVisualViewAvailable(data: BootstrapDto, location: CreatorLocation): boolean {
  if (location.surface !== 'existing-creation') return true;
  const series = data.series.find((item) => item.id === location.seriesId);
  if (!series) return false;
  if (location.versionId && !derivedVisualWorkspaceVersion(series, location.versionId)) return false;
  const output = location.outputSeriesId ? data.series.find((item) => item.id === location.outputSeriesId) : series;
  return Boolean(output && (!location.assetId || allAssets(output).some((asset) => asset.id === location.assetId)));
}

function initialDerivedVisualSession(data: BootstrapDto, location: CreatorLocation): CreatorInitialSession | null {
  const visual = derivedVisualForLocation(data, location);
  if (!visual) return null;
  const viewAvailable = savedDerivedVisualViewAvailable(data, location);
  const initialSeriesId = viewAvailable ? visual.promptSeriesId : null;
  const initialDraft =
    viewAvailable && !initialSeriesId && data.creationDraft?.id === visual.creationDraftId ? data.creationDraft : null;
  const initialCreationMode = initialSeriesId ? 'existing' : 'new';
  return {
    derivedDraftParentLocation: null,
    initialAssistantRun: activeAssistantRun(data, initialCreationMode, initialDraft, initialSeriesId),
    initialCreationMode,
    initialDraft,
    initialSeriesId,
    initialInspirationItemAlbumId: null,
    initialInspirationStashAlbumId: null,
  };
}

function standardCreatorInitialSession(
  data: BootstrapDto,
  location: CreatorLocation,
  creationSessions: readonly CreationSessionProjection[],
): CreatorInitialSession {
  const initialInspirationStash =
    location.surface === 'inspiration-stash'
      ? (data.inspirationStashes ?? []).find((stash) => stash.id === location.stashId)
      : undefined;
  const initialInspirationItem = initialInspirationStash
    ? creationItemByFormEntity(data.creationItems, 'ARTICLE', initialInspirationStash.id)
    : null;
  const initialInspirationSeriesId = imageSeriesIdForCreationItem(initialInspirationItem);
  const initialSocialPost =
    location.surface === 'social-post'
      ? (data.socialPosts ?? []).find((post) => post.id === location.postId)
      : undefined;
  const initialArticle =
    location.surface === 'article'
      ? (data.articles ?? []).find((article) => article.id === location.articleId)
      : undefined;
  const resumableDerivedVisual = (data.derivedVisuals ?? []).find(
    (visual) =>
      visual.adoptedAt === null &&
      ((initialArticle && visual.articleId === initialArticle.id) ||
        (initialSocialPost && visual.socialPostId === initialSocialPost.id)) &&
      ((visual.promptSeriesId && data.series.some((series) => series.id === visual.promptSeriesId)) ||
        data.creationDraft?.id === visual.creationDraftId),
  );
  const resumableDerivedSeriesId = resumableDerivedVisual?.promptSeriesId ?? null;
  const resumableDerivedDraft =
    !resumableDerivedSeriesId && data.creationDraft?.id === resumableDerivedVisual?.creationDraftId
      ? data.creationDraft
      : null;
  const standaloneSeriesId = defaultStandaloneCreationSeriesId(data, creationSessions);
  const standaloneDraft = defaultStandaloneCreationDraft(data);
  const locatedDraft =
    location.surface === 'creation-draft' && data.creationDraft?.id === location.draftId ? data.creationDraft : null;
  const hasInitialContent = Boolean(initialSocialPost || initialArticle);
  const initialCreationMode = resolveCreationMode({
    location,
    resumableDerivedSeriesId,
    hasInitialContent,
    hasInspiration: Boolean(initialInspirationStash),
    inspirationSeriesId: initialInspirationSeriesId,
    hasStandaloneDraft: Boolean(standaloneDraft),
    standaloneSeriesId,
  });
  const initialDraft =
    locatedDraft ??
    resumableDerivedDraft ??
    (location.surface !== 'new-creation' &&
    location.surface !== 'creation-draft' &&
    initialCreationMode === 'new' &&
    !initialSocialPost &&
    !initialArticle
      ? standaloneDraft
      : null);
  const initialSeriesId = resolveInitialSeriesId({
    location,
    resumableDerivedSeriesId,
    hasInitialContent,
    inspirationSeriesId: initialInspirationSeriesId,
    hasDraft: Boolean(initialDraft),
    standaloneSeriesId,
  });
  const initialAssistantRun = activeAssistantRun(data, initialCreationMode, initialDraft, initialSeriesId);

  return {
    derivedDraftParentLocation: defaultDerivedDraftParentLocation(data),
    initialAssistantRun,
    initialCreationMode,
    initialDraft,
    initialInspirationItemAlbumId: initialInspirationItem?.albumId ?? null,
    initialInspirationStashAlbumId: initialInspirationStash?.albumId ?? null,
    initialSeriesId,
  };
}

export function creatorInitialSession(
  data: BootstrapDto,
  location: CreatorLocation,
  creationSessions: readonly CreationSessionProjection[],
) {
  return initialDerivedVisualSession(data, location) ?? standardCreatorInitialSession(data, location, creationSessions);
}
