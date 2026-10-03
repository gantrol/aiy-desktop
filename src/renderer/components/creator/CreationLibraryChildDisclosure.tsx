import { FoldVerticalIcon, ListCollapseIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { TreeBranchCollapseProvider, TreeBranchContent } from '@/renderer/components/albums/TreeDisclosureRail';
import {
  CREATION_TREE_COMPACT_NODE_METRICS,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import { CreationLibraryTreeItem } from '@/renderer/components/creator/CreationLibraryTreeItem';
import { ActionContextMenuItems } from '@/renderer/components/ui/action-menu';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';

interface Props {
  branchTopology?: TreeBranchItemTopology;
  collapseLabel: string;
  label: string;
  loading: boolean;
  resetLabel?: string;
  onCollapse(): void;
  onReveal(): void;
  onReset?(): void;
}

/** A compact continuation row for the next hidden batch in an expanded directory. */
export function CreationLibraryChildDisclosure({
  branchTopology,
  collapseLabel,
  label,
  loading,
  resetLabel,
  onCollapse,
  onReveal,
  onReset,
}: Props) {
  const row = (
    <CreationLibraryTreeItem
      dataAttributes={{ 'data-creation-library-child-disclosure': true }}
      branchTopology={branchTopology}
      selected={false}
      compact
      ariaLabel={label}
      aria-busy={loading}
      openLabel={label}
      title={label}
      titleClassName="text-sm font-normal text-muted-foreground"
      previewBounds={CREATION_TREE_COMPACT_NODE_METRICS.bounds}
      previewStyle={{ width: CREATION_TREE_COMPACT_NODE_METRICS.width }}
      preview={
        <span className="ml-7 grid size-7 place-items-center text-muted-foreground">
          <ListCollapseIcon className="size-5" aria-hidden="true" />
        </span>
      }
      controls={
        loading ? (
          <LoaderCircleIcon className="pointer-events-none relative z-10 mr-3 size-3.5 animate-spin text-muted-foreground" />
        ) : null
      }
      onOpen={() => {
        if (!loading) onReveal();
      }}
    />
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ActionContextMenuItems
          actions={[
            ...(resetLabel && onReset
              ? [{ id: 'reset-disclosure', label: resetLabel, icon: ListCollapseIcon, onSelect: onReset }]
              : []),
            { id: 'collapse', label: collapseLabel, icon: FoldVerticalIcon, onSelect: onCollapse },
          ]}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface ChildListProps extends Props {
  children: ReactNode;
  hasVisibleChildren: boolean;
  onCollapse(): void;
  showDisclosure: boolean;
}

/** Keeps list truncation inside the existing branch rail without creating another tree level. */
export function CreationLibraryChildList({
  children,
  branchTopology,
  collapseLabel,
  hasVisibleChildren,
  label,
  loading,
  resetLabel,
  onCollapse,
  onReveal,
  onReset,
  showDisclosure,
}: ChildListProps) {
  if (!hasVisibleChildren && !showDisclosure) return null;
  return (
    <TreeBranchContent>
      <TreeBranchCollapseProvider onCollapse={onCollapse}>
        {children}
        {showDisclosure && (
          <CreationLibraryChildDisclosure
            branchTopology={branchTopology}
            collapseLabel={collapseLabel}
            label={label}
            loading={loading}
            resetLabel={resetLabel}
            onCollapse={onCollapse}
            onReveal={onReveal}
            onReset={onReset}
          />
        )}
      </TreeBranchCollapseProvider>
    </TreeBranchContent>
  );
}
