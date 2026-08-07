import { FoldVerticalIcon, UnfoldVerticalIcon } from 'lucide-react';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';

interface AlbumExpansionActionOptions {
  expanded: boolean;
  expandLabel: string;
  collapseLabel: string;
  onExpandedChange(expanded: boolean): void;
}

export function createAlbumExpansionAction({
  expanded,
  expandLabel,
  collapseLabel,
  onExpandedChange,
}: AlbumExpansionActionOptions): ActionMenuAction {
  return {
    id: expanded ? 'collapse' : 'expand',
    label: expanded ? collapseLabel : expandLabel,
    icon: expanded ? FoldVerticalIcon : UnfoldVerticalIcon,
    onSelect: () => onExpandedChange(!expanded),
  };
}
