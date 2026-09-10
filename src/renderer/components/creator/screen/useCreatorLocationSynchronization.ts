import { useEffect, type MutableRefObject } from 'react';
import type { BootstrapDto, CreationDraftDto } from '@/shared/contracts';
import {
  navigationLocationKey,
  type CreatorLocation,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import type { CreatorActiveSelection } from '@/renderer/components/creator/screen/useCreatorLocationSelection';
import type { CreatorLocationApplication } from '@/renderer/components/creator/screen/useCreatorNavigationCore';
import { useCreatorSelectionValidity } from '@/renderer/components/creator/screen/useCreatorSelectionValidity';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import {
  derivedVisualForLocation,
  isDerivedVisualLocation,
  type DerivedVisualWorkspaceViewState,
} from '@/renderer/components/creator/derivedVisualWorkspace';

interface NavigationActions {
  resumeDerivedVisual(id: string, view?: DerivedVisualWorkspaceViewState): Promise<void>;
  chooseAlbum(id: string, mode: NavigationMode | null): Promise<boolean>;
  chooseArticle(id: string, mode: NavigationMode | null): Promise<boolean>;
  chooseEvaluationSuite(id: string, mode: NavigationMode | null): Promise<boolean>;
  chooseIdeaCreation(id: string, mode: NavigationMode | null): Promise<boolean>;
  chooseImageBreakdown(id: string, mode: NavigationMode | null): Promise<boolean>;
  chooseInspirationStash(id: string, mode: NavigationMode | null): Promise<boolean>;
  chooseSeries(id: string, assetId?: string, mode?: NavigationMode | null, versionId?: string): Promise<boolean>;
  chooseSocialPost(id: string, mode: NavigationMode | null): Promise<boolean>;
  resumeCreationDraft(draftId: string, mode: NavigationMode | null): Promise<boolean>;
  startNewCreation(albumId: string | null, mode: NavigationMode | null): Promise<boolean>;
}

interface Options {
  actions: NavigationActions;
  active: boolean;
  activeAlbumContextId: string | null;
  locationApplicationRef: MutableRefObject<CreatorLocationApplication>;
  clearSavedInspiration(): void;
  clearSelection(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  creationDraftId: string | null;
  creationMode: 'existing' | 'new';
  data: BootstrapDto;
  derivedDraftParentLocation: CreatorLocation | null;
  initialDraft: CreationDraftDto | null;
  initialSeriesId: string | null;
  location: CreatorLocation;
  onActiveAlbumChange(albumId: string | null): void;
  onPromptFullWindowChange(open: boolean): void;
  requestedAssetId: string | null;
  selection: CreatorActiveSelection;
  seriesId: string | null;
  setOutputModeToResults(): void;
  targetAlbumId: string | null;
  workbenchLocation(): CreatorLocation;
}

export function useCreatorLocationSynchronization(options: Options) {
  const commit = useStableCallback(options.commit);
  const closePrompt = useStableCallback(() => options.onPromptFullWindowChange(false));
  const workbenchLocation = useStableCallback(options.workbenchLocation);
  const clearSavedInspiration = useStableCallback(options.clearSavedInspiration);
  const setOutputModeToResults = useStableCallback(options.setOutputModeToResults);
  const chooseAlbum = useStableCallback(options.actions.chooseAlbum);
  const chooseArticle = useStableCallback(options.actions.chooseArticle);
  const chooseEvaluationSuite = useStableCallback(options.actions.chooseEvaluationSuite);
  const chooseIdeaCreation = useStableCallback(options.actions.chooseIdeaCreation);
  const chooseImageBreakdown = useStableCallback(options.actions.chooseImageBreakdown);
  const chooseInspirationStash = useStableCallback(options.actions.chooseInspirationStash);
  const chooseSeries = useStableCallback(options.actions.chooseSeries);
  const resumeDerivedVisual = useStableCallback(options.actions.resumeDerivedVisual);
  const chooseSocialPost = useStableCallback(options.actions.chooseSocialPost);
  const resumeCreationDraft = useStableCallback(options.actions.resumeCreationDraft);
  const startNewCreation = useStableCallback(options.actions.startNewCreation);
  const onActiveAlbumChange = useStableCallback(options.onActiveAlbumChange);

  useCreatorSelectionValidity({
    activeIds: {
      albums: options.data.albums.map((item) => item.id),
      articles: (options.data.articles ?? []).map((item) => item.id),
      evaluationSuites: (options.data.evaluationSuites ?? []).map((item) => item.id),
      ideaCreations: (options.data.creations ?? []).map((item) => item.id),
      imageBreakdowns: (options.data.imageBreakdowns ?? []).map((item) => item.id),
      inspirationStashes: (options.data.inspirationStashes ?? []).map((item) => item.id),
      socialPosts: (options.data.socialPosts ?? []).map((item) => item.id),
    },
    clearSelection: options.clearSelection,
    commit,
    currentLocation: options.location,
    onInvalidated(kind) {
      if (kind === 'INSPIRATION_STASH') clearSavedInspiration();
      if (kind === 'IDEA_CREATION') setOutputModeToResults();
    },
    replacementLocation(kind) {
      if (kind === 'ALBUM' || kind === 'EVALUATION_SUITE' || kind === 'IMAGE_BREAKDOWN') {
        return workbenchLocation();
      }
      if (options.creationMode === 'new') return workbenchLocation();
      return options.seriesId
        ? { surface: 'existing-creation', seriesId: options.seriesId, assetId: options.requestedAssetId }
        : { surface: 'default' };
    },
    selection: options.selection,
  });

  useEffect(() => {
    onActiveAlbumChange(options.activeAlbumContextId);
  }, [onActiveAlbumChange, options.activeAlbumContextId]);

  useEffect(() => {
    if (!options.active) return;
    if (options.location.surface === 'default') {
      const canonical =
        options.derivedDraftParentLocation ??
        (options.initialDraft
          ? { surface: 'creation-draft' as const, draftId: options.initialDraft.id }
          : options.initialSeriesId
            ? {
                surface: 'existing-creation' as const,
                seriesId: options.initialSeriesId,
                assetId: null,
              }
            : { surface: 'new-creation' as const, albumId: null });
      commit(canonical, 'replace');
      return;
    }
    const key = navigationLocationKey(options.location);
    if (options.locationApplicationRef.current.requestedKey === key) return;
    closePrompt();
    const location = options.location;
    const visual = derivedVisualForLocation(options.data, location);
    // Derived workspaces finish asynchronously; their commit confirms the restored view.
    options.locationApplicationRef.current = { requestedKey: key, appliedKey: visual ? null : key };
    if (visual) {
      void resumeDerivedVisual(
        visual.id,
        location.surface === 'existing-creation'
          ? {
              versionId: location.versionId,
              outputSeriesId: location.outputSeriesId,
              assetId: location.assetId,
              navigationMode: 'replace',
            }
          : { navigationMode: 'replace' },
      );
      return;
    }
    if (isDerivedVisualLocation(location)) {
      commit({ surface: 'default' }, 'replace');
      return;
    }
    if (location.surface === 'album-detail') void chooseAlbum(location.albumId, null);
    else if (location.surface === 'existing-creation')
      void chooseSeries(location.seriesId, location.assetId ?? undefined, null, location.versionId);
    else if (location.surface === 'idea-creation') void chooseIdeaCreation(location.creationId, null);
    else if (location.surface === 'inspiration-stash') void chooseInspirationStash(location.stashId, null);
    else if (location.surface === 'image-breakdown') void chooseImageBreakdown(location.breakdownId, null);
    else if (location.surface === 'evaluation-suite') void chooseEvaluationSuite(location.suiteId, null);
    else if (location.surface === 'social-post') void chooseSocialPost(location.postId, null);
    else if (location.surface === 'article') void chooseArticle(location.articleId, null);
    else if (location.surface === 'creation-draft') void resumeCreationDraft(location.draftId, null);
    else if (location.surface === 'new-creation') void startNewCreation(location.albumId, null);
  }, [
    chooseAlbum,
    chooseArticle,
    chooseEvaluationSuite,
    chooseIdeaCreation,
    chooseImageBreakdown,
    chooseInspirationStash,
    chooseSeries,
    chooseSocialPost,
    closePrompt,
    commit,
    options.active,
    options.locationApplicationRef,
    options.derivedDraftParentLocation,
    options.initialDraft,
    options.initialSeriesId,
    options.location,
    options.data,
    resumeDerivedVisual,
    resumeCreationDraft,
    startNewCreation,
  ]);

  useEffect(() => {
    if (
      !options.active ||
      options.creationMode !== 'new' ||
      !options.creationDraftId ||
      options.location.surface !== 'new-creation'
    ) {
      return;
    }
    commit({ surface: 'creation-draft', draftId: options.creationDraftId }, 'replace');
  }, [commit, options.active, options.creationDraftId, options.creationMode, options.location.surface]);
}
