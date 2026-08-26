import { FoldVerticalIcon, ListCollapseIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { TreeBranchCollapseProvider, TreeBranchContent } from '@/renderer/components/albums/TreeDisclosureRail';
import type { TreeBranchItemTopology } from '@/renderer/components/albums/treeConnectionGeometry';
import { MediaStackPreview } from '@/renderer/components/media/MediaStackPreview';
import {
  CreationLibraryTreeItem,
  getCreationTreeMediaNodeMetrics,
} from '@/renderer/components/creator/CreationLibraryTreeItem';
import { ActionContextMenuItems } from '@/renderer/components/ui/action-menu';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';

interface Props {
  branchTopology?: TreeBranchItemTopology;
  collapseLabel: string;
  label: string;
  loading: boolean;
  previewAssets: readonly AssetDto[];
  resetLabel?: string;
  onCollapse(): void;
  onReveal(): void;
  onReset?(): void;
}

/** A covered continuation row for the next hidden batch in an expanded directory. */
export function CreationLibraryChildDisclosure({
  branchTopology,
  collapseLabel,
  label,
  loading,
  previewAssets,
  resetLabel,
  onCollapse,
  onReveal,
  onReset,
}: Props) {
  const previewItems = previewAssets.slice(0, 3).map((asset) => ({ asset }));
  const previewMetrics = getCreationTreeMediaNodeMetrics(previewItems);
  const row = (
    <CreationLibraryTreeItem
      dataAttributes={{ 'data-creation-library-child-disclosure': true }}
      branchTopology={branchTopology}
      selected={false}
      ariaLabel={label}
      aria-busy={loading}
      openLabel={label}
      title={label}
      titleClassName="text-sm font-normal text-muted-foreground"
      previewBounds={previewMetrics.bounds}
      previewStyle={{ width: previewMetrics.width }}
      preview={
        <MediaStackPreview
          className="pointer-events-none"
          items={previewItems}
          maxItems={3}
          singleItemAlign="center"
          size="tree"
          spread="settled"
        />
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
  expanded: boolean;
  hasVisibleChildren: boolean;
  onCollapse(): void;
  showDisclosure: boolean;
}

/** Keeps list truncation inside the existing branch rail without creating another tree level. */
export function CreationLibraryChildList({
  children,
  branchTopology,
  collapseLabel,
  expanded,
  hasVisibleChildren,
  label,
  loading,
  previewAssets,
  resetLabel,
  onCollapse,
  onReveal,
  onReset,
  showDisclosure,
}: ChildListProps) {
  if (!expanded || (!hasVisibleChildren && !showDisclosure)) return null;
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
            previewAssets={previewAssets}
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
