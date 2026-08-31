import { useRef } from 'react';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import { navigationLocationKey } from '@/renderer/components/app/app-navigation';
import type { CreationStartMode } from '@/renderer/components/creator/creationStartMode';
import { writeCreationStartMode } from '@/renderer/components/creator/creationStartMode';
import type { VideoDocumentCreationRequest } from '@/renderer/features/video-documents/VideoDocumentCreationStarter';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  closeDictionary(): void;
  creationMode: 'existing' | 'new';
  getDraftId(): string | null;
  initialLocation: CreatorLocation;
  location: CreatorLocation;
  notify(message: string): void;
  onNavigate(location: CreatorLocation, mode?: NavigationMode): void;
  onPromptFullWindowChange(open: boolean): void;
  requestedAssetId: string | null;
  saveDraft(albumId?: string | null): Promise<unknown>;
  selected: {
    articleId: string | null;
    evaluationSuiteId: string | null;
    ideaCreationId: string | null;
    imageBreakdownId: string | null;
    inspirationStashId: string | null;
    socialPostId: string | null;
  };
  seriesId: string | null;
  setCreationStartMode(mode: CreationStartMode): void;
  setRequestedAssetId(assetId: string): void;
  setTargetAlbumId(albumId: string | null): void;
  setVideoCreationRequest(request: VideoDocumentCreationRequest | null): void;
  targetAlbumId: string | null;
}

function initialAppliedLocationKey(location: CreatorLocation) {
  return location.surface === 'inspiration-stash' ||
    location.surface === 'image-breakdown' ||
    location.surface === 'evaluation-suite' ||
    location.surface === 'social-post' ||
    location.surface === 'article' ||
    location.surface === 'new-creation' ||
    location.surface === 'creation-draft'
    ? ''
    : navigationLocationKey(location);
}

export function useCreatorNavigationCore(options: Options) {
  const appliedLocationKeyRef = useRef(initialAppliedLocationKey(options.initialLocation));
  const commit = useStableCallback((location: CreatorLocation, mode: NavigationMode = 'push') => {
    appliedLocationKeyRef.current = navigationLocationKey(location);
    options.onNavigate(location, mode);
  });
  const workbenchLocation = useStableCallback((): CreatorLocation => {
    const selected = options.selected;
    if (selected.evaluationSuiteId) return { surface: 'evaluation-suite', suiteId: selected.evaluationSuiteId };
    if (selected.imageBreakdownId) return { surface: 'image-breakdown', breakdownId: selected.imageBreakdownId };
    if (selected.socialPostId) return { surface: 'social-post', postId: selected.socialPostId };
    if (selected.articleId) return { surface: 'article', articleId: selected.articleId };
    if (selected.ideaCreationId) return { surface: 'idea-creation', creationId: selected.ideaCreationId };
    if (selected.inspirationStashId) return { surface: 'inspiration-stash', stashId: selected.inspirationStashId };
    if (options.creationMode === 'new') {
      const draftId = options.getDraftId();
      return draftId
        ? { surface: 'creation-draft', draftId }
        : { surface: 'new-creation', albumId: options.targetAlbumId };
    }
    if (options.seriesId) {
      return { surface: 'existing-creation', seriesId: options.seriesId, assetId: options.requestedAssetId };
    }
    return { surface: 'default' };
  });
  const selectOutputAsset = useStableCallback((assetId: string, mode: NavigationMode = 'push') => {
    options.setRequestedAssetId(assetId);
    if (options.creationMode === 'existing' && options.seriesId) {
      commit({ surface: 'existing-creation', seriesId: options.seriesId, assetId }, mode);
    }
  });
  const selectCreationStartMode = useStableCallback((mode: CreationStartMode) => {
    options.setCreationStartMode(mode);
    writeCreationStartMode(mode);
    if (mode === 'image') options.setVideoCreationRequest(null);
    else options.onPromptFullWindowChange(false);
  });
  const changePromptFullWindow = useStableCallback((open: boolean) => {
    options.onPromptFullWindowChange(open);
    if (open) options.closeDictionary();
  });
  const changeNewCreationAlbum = useStableCallback(async (albumId: string | null) => {
    if (options.creationMode !== 'new' || albumId === options.targetAlbumId) return;
    const previousAlbumId = options.targetAlbumId;
    options.setTargetAlbumId(albumId);
    if (options.location.surface === 'new-creation') commit({ surface: 'new-creation', albumId }, 'replace');
    try {
      await options.saveDraft(albumId);
    } catch (reason) {
      options.setTargetAlbumId(previousAlbumId);
      if (options.location.surface === 'new-creation') {
        commit({ surface: 'new-creation', albumId: previousAlbumId }, 'replace');
      }
      options.notify(reason instanceof Error ? reason.message : String(reason));
    }
  });

  return {
    appliedLocationKeyRef,
    changeNewCreationAlbum,
    changePromptFullWindow,
    commit,
    selectCreationStartMode,
    selectOutputAsset,
    workbenchLocation,
  };
}
