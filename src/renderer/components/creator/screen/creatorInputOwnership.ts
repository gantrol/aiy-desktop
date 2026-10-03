import type { useCreatorContentSelection } from '@/renderer/components/creator/screen/useCreatorContentSelection';

type Selection = Pick<
  ReturnType<typeof useCreatorContentSelection>,
  | 'selectedAlbumId'
  | 'selectedArticleId'
  | 'selectedSocialPostId'
  | 'selectedEvaluationSuiteId'
  | 'selectedImageBreakdownId'
  | 'selectedInspirationStashId'
>;

/** Input ownership is independent of pane visibility, focus and retained editor state. */
export function creatorInputOwner(selection: Selection, editingDerivedVisual: boolean) {
  if (selection.selectedAlbumId || selection.selectedEvaluationSuiteId || selection.selectedImageBreakdownId)
    return null;
  if ((selection.selectedArticleId || selection.selectedSocialPostId) && !editingDerivedVisual) return null;
  return selection.selectedInspirationStashId ? 'inspiration' : 'creation';
}
