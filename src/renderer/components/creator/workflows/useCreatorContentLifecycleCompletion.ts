import type { BootstrapDto } from '@/shared/contracts';
import type { ContentLifecycleActionRequest } from '@/renderer/components/albums/useContentLifecycleActions';
import type { AlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import {
  selectedContentLifecycleTarget,
  selectedCreationItemId,
} from '@/renderer/components/creator/screen/creatorScreenProjection';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  albumTree: AlbumTreeIndex;
  clearSavedInspiration(): void;
  clearSelection(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  data: Pick<BootstrapDto, 'creationItems'>;
  detachDraftFromUnavailableAlbum(albumId: string, includeDescendants: boolean): Promise<boolean>;
  refresh(): Promise<void>;
  refreshAlbums(): Promise<void>;
  selected: {
    albumId: string | null;
    articleId: string | null;
    documentId: string | null;
    evaluationSuiteId: string | null;
    ideaCreationId: string | null;
    imageBreakdownId: string | null;
    inspirationStashId: string | null;
    seriesId: string | null;
    socialPostId: string | null;
  };
  setOutputModeToResults(): void;
  startNewCreation(albumId: string | null, mode: NavigationMode): Promise<boolean>;
  workbenchLocation(): CreatorLocation;
}

export function useCreatorContentLifecycleCompletion(options: Options) {
  return useStableCallback(async ({ target }: ContentLifecycleActionRequest) => {
    if (target.entityType === 'ALBUM') {
      await options.detachDraftFromUnavailableAlbum(target.entityId, true);
      if (options.selected.albumId) {
        let currentAlbumId: string | undefined = options.selected.albumId;
        while (currentAlbumId) {
          if (currentAlbumId === target.entityId) {
            options.clearSelection();
            options.commit(options.workbenchLocation(), 'replace');
            break;
          }
          currentAlbumId = options.albumTree.parentById.get(currentAlbumId);
        }
      }
      await Promise.all([options.refresh(), options.refreshAlbums()]);
      return;
    }
    const currentCreationItemId = selectedCreationItemId(options.data.creationItems, {
      seriesId: options.selected.seriesId,
      imageBreakdownId: options.selected.imageBreakdownId,
      evaluationSuiteId: options.selected.evaluationSuiteId,
      inspirationStashId: options.selected.inspirationStashId,
      socialPostId: options.selected.socialPostId,
      articleId: options.selected.articleId,
      videoDocumentId: options.selected.documentId,
    });
    const selectedTarget = selectedContentLifecycleTarget(target, {
      CREATION_ITEM: currentCreationItemId,
      PROMPT_SERIES: options.selected.seriesId,
      CREATION: options.selected.ideaCreationId,
      INSPIRATION_STASH: options.selected.inspirationStashId,
      IMAGE_BREAKDOWN: options.selected.imageBreakdownId,
      EVALUATION_SUITE: options.selected.evaluationSuiteId,
      SOCIAL_POST: options.selected.socialPostId,
      ARTICLE: options.selected.articleId,
      VIDEO_DOCUMENT: options.selected.documentId,
    });
    if (selectedTarget) options.clearSelection();
    if (target.entityType === 'INSPIRATION_STASH' && target.entityId === options.selected.inspirationStashId)
      options.clearSavedInspiration();
    if (target.entityType === 'CREATION' && target.entityId === options.selected.ideaCreationId) {
      options.setOutputModeToResults();
    }
    await options.refresh();
    if (selectedTarget) await options.startNewCreation(null, 'replace');
  });
}
