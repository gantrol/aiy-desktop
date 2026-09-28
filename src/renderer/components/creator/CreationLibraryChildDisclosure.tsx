import { FoldVerticalIcon, ListCollapseIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { TreeBranchCollapseProvider, TreeBranchContent } from '@/renderer/components/albums/TreeDisclosureRail';
import {
  COMPACT_TREE_NODE_METRICS,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
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
  onAssetSelect?(asset: AssetDto): void;
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
  onAssetSelect,
}: Props) {
  const previewItems = previewAssets.slice(0, 3).map((asset) => ({ asset }));
  const compact = previewItems.length === 0;
  const previewMetrics = compact ? COMPACT_TREE_NODE_METRICS : getCreationTreeMediaNodeMetrics(previewItems);
  const row = (
    <CreationLibraryTreeItem
      dataAttributes={{ 'data-creation-library-child-disclosure': true }}
      branchTopology={branchTopology}
      selected={false}
      compact={compact}
      ariaLabel={label}
      aria-busy={loading}
      openLabel={label}
      title={label}
      titleClassName="text-sm font-normal text-muted-foreground"
      previewBounds={previewMetrics.bounds}
      previewStyle={{ width: previewMetrics.width }}
      canSpreadPreview={previewItems.length > 1}
      preview={
        compact ? (
          <span className="mx-1 grid size-7 place-items-center text-muted-foreground">
            <ListCollapseIcon className="size-4" aria-hidden="true" />
          </span>
        ) : (
          (expanded) => (
            <MediaStackPreview
              className="pointer-events-none"
              items={previewItems}
              maxItems={3}
              singleItemAlign="center"
              size="tree"
              spread={expanded ? 'expanded' : 'settled'}
              onAssetSelect={onAssetSelect}
            />
          )
        )
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
  previewAssets,
  resetLabel,
  onCollapse,
  onReveal,
  onReset,
  onAssetSelect,
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
            previewAssets={previewAssets}
            resetLabel={resetLabel}
            onCollapse={onCollapse}
            onReveal={onReveal}
            onReset={onReset}
            onAssetSelect={onAssetSelect}
          />
        )}
      </TreeBranchCollapseProvider>
    </TreeBranchContent>
  );
}
