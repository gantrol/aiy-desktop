import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type SelectionKind =
  'INSPIRATION_STASH' | 'IMAGE_BREAKDOWN' | 'EVALUATION_SUITE' | 'SOCIAL_POST' | 'ARTICLE' | 'ALBUM' | 'IDEA_CREATION';

export type CreatorActiveSelection = { kind: SelectionKind; id: string } | { kind: 'WORKBENCH' };

function selectionFromLocation(location: CreatorLocation): CreatorActiveSelection {
  if (location.surface === 'inspiration-stash') return { kind: 'INSPIRATION_STASH', id: location.stashId };
  if (location.surface === 'image-breakdown') return { kind: 'IMAGE_BREAKDOWN', id: location.breakdownId };
  if (location.surface === 'evaluation-suite') return { kind: 'EVALUATION_SUITE', id: location.suiteId };
  if (location.surface === 'social-post') return { kind: 'SOCIAL_POST', id: location.postId };
  if (location.surface === 'article') return { kind: 'ARTICLE', id: location.articleId };
  if (location.surface === 'album-detail') return { kind: 'ALBUM', id: location.albumId };
  if (location.surface === 'idea-creation') return { kind: 'IDEA_CREATION', id: location.creationId };
  return { kind: 'WORKBENCH' };
}

function selectedId(selection: CreatorActiveSelection, kind: SelectionKind) {
  return selection.kind === kind ? selection.id : null;
}

export function useCreatorLocationSelection(initialLocation: CreatorLocation) {
  const [selection, setSelection] = useState<CreatorActiveSelection>(() => selectionFromLocation(initialLocation));

  const updateSelection = useStableCallback((kind: SelectionKind, nextValue: SetStateAction<string | null>) => {
    setSelection((current) => {
      const currentId = selectedId(current, kind);
      const nextId = typeof nextValue === 'function' ? nextValue(currentId) : nextValue;
      if (nextId) return current.kind === kind && current.id === nextId ? current : { kind, id: nextId };
      return current.kind === kind ? { kind: 'WORKBENCH' } : current;
    });
  });
  const setters = useMemo(() => {
    const setter =
      (kind: SelectionKind): Dispatch<SetStateAction<string | null>> =>
      (nextValue) =>
        updateSelection(kind, nextValue);
    return {
      setSelectedInspirationStashId: setter('INSPIRATION_STASH'),
      setSelectedImageBreakdownId: setter('IMAGE_BREAKDOWN'),
      setSelectedEvaluationSuiteId: setter('EVALUATION_SUITE'),
      setSelectedSocialPostId: setter('SOCIAL_POST'),
      setSelectedArticleId: setter('ARTICLE'),
      setSelectedAlbumId: setter('ALBUM'),
      setSelectedIdeaCreationId: setter('IDEA_CREATION'),
    };
  }, [updateSelection]);
  const clearSelection = useStableCallback(() => setSelection({ kind: 'WORKBENCH' }));

  return {
    selectedAlbumId: selectedId(selection, 'ALBUM'),
    selectedArticleId: selectedId(selection, 'ARTICLE'),
    selectedEvaluationSuiteId: selectedId(selection, 'EVALUATION_SUITE'),
    selectedIdeaCreationId: selectedId(selection, 'IDEA_CREATION'),
    selectedImageBreakdownId: selectedId(selection, 'IMAGE_BREAKDOWN'),
    selectedInspirationStashId: selectedId(selection, 'INSPIRATION_STASH'),
    selectedSocialPostId: selectedId(selection, 'SOCIAL_POST'),
    selection,
    clearSelection,
    ...setters,
  };
}
