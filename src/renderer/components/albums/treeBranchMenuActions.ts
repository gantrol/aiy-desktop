import { FoldVerticalIcon, UnfoldVerticalIcon } from 'lucide-react';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';

export interface TreeBranchExpansionActionOptions {
  expanded: boolean;
  expandLabel: string;
  collapseLabel: string;
  onExpandedChange(expanded: boolean): void;
}

/** One menu contract for opening a hierarchy branch; list truncation is a separate action. */
export function createTreeBranchExpansionAction({
  expanded,
  expandLabel,
  collapseLabel,
  onExpandedChange,
}: TreeBranchExpansionActionOptions): ActionMenuAction {
  return {
    id: expanded ? 'collapse-branch' : 'expand-branch',
    label: expanded ? collapseLabel : expandLabel,
    icon: expanded ? FoldVerticalIcon : UnfoldVerticalIcon,
    onSelect: () => onExpandedChange(!expanded),
  };
}
