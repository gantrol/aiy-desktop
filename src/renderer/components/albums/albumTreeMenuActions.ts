import { createTreeBranchExpansionAction } from '@/renderer/components/albums/treeBranchMenuActions';
import type { TreeBranchExpansionActionOptions } from '@/renderer/components/albums/treeBranchMenuActions';

export function createAlbumExpansionAction({
  expanded,
  expandLabel,
  collapseLabel,
  onExpandedChange,
}: TreeBranchExpansionActionOptions) {
  return {
    ...createTreeBranchExpansionAction({ expanded, expandLabel, collapseLabel, onExpandedChange }),
    id: expanded ? 'collapse' : 'expand',
  };
}
