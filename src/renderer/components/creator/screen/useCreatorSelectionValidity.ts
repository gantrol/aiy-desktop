import { useEffect } from 'react';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { CreatorActiveSelection } from '@/renderer/components/creator/screen/useCreatorLocationSelection';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  activeIds: {
    albums: readonly string[];
    articles: readonly string[];
    evaluationSuites: readonly string[];
    ideaCreations: readonly string[];
    imageBreakdowns: readonly string[];
    inspirationStashes: readonly string[];
    socialPosts: readonly string[];
  };
  clearSelection(): void;
  commit(location: CreatorLocation, mode: NavigationMode): void;
  currentLocation: CreatorLocation;
  onInvalidated(kind: CreatorActiveSelection['kind']): void;
  replacementLocation(kind: CreatorActiveSelection['kind']): CreatorLocation;
  selection: CreatorActiveSelection;
}

function selectedLocationMatches(
  selection: Exclude<CreatorActiveSelection, { kind: 'WORKBENCH' }>,
  location: CreatorLocation,
) {
  if (selection.kind === 'ALBUM') return location.surface === 'album-detail' && location.albumId === selection.id;
  if (selection.kind === 'ARTICLE') return location.surface === 'article' && location.articleId === selection.id;
  if (selection.kind === 'EVALUATION_SUITE')
    return location.surface === 'evaluation-suite' && location.suiteId === selection.id;
  if (selection.kind === 'IDEA_CREATION')
    return location.surface === 'idea-creation' && location.creationId === selection.id;
  if (selection.kind === 'IMAGE_BREAKDOWN')
    return location.surface === 'image-breakdown' && location.breakdownId === selection.id;
  if (selection.kind === 'INSPIRATION_STASH')
    return location.surface === 'inspiration-stash' && location.stashId === selection.id;
  return location.surface === 'social-post' && location.postId === selection.id;
}

export function useCreatorSelectionValidity(options: Options) {
  const clearSelection = useStableCallback(options.clearSelection);
  const commit = useStableCallback(options.commit);
  const onInvalidated = useStableCallback(options.onInvalidated);
  const replacementLocation = useStableCallback(options.replacementLocation);
  const activeIds = options.activeIds;

  useEffect(() => {
    const selection = options.selection;
    if (selection.kind === 'WORKBENCH') return;
    const available =
      selection.kind === 'ALBUM'
        ? activeIds.albums
        : selection.kind === 'ARTICLE'
          ? activeIds.articles
          : selection.kind === 'EVALUATION_SUITE'
            ? activeIds.evaluationSuites
            : selection.kind === 'IDEA_CREATION'
              ? activeIds.ideaCreations
              : selection.kind === 'IMAGE_BREAKDOWN'
                ? activeIds.imageBreakdowns
                : selection.kind === 'INSPIRATION_STASH'
                  ? activeIds.inspirationStashes
                  : activeIds.socialPosts;
    if (available.includes(selection.id)) return;
    clearSelection();
    onInvalidated(selection.kind);
    if (selectedLocationMatches(selection, options.currentLocation)) {
      commit(replacementLocation(selection.kind), 'replace');
    }
  }, [
    activeIds,
    clearSelection,
    commit,
    onInvalidated,
    options.currentLocation,
    options.selection,
    replacementLocation,
  ]);
}
