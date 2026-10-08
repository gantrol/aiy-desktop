import type { MouseEventHandler, ReactNode } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { AlbumGlyphIcon } from '@/renderer/icons';
import { albumCoverAssets, ALBUM_COVER_LAYERS } from '@/renderer/components/albums/albumCoverAssets';
import {
  AlbumContentCover,
  AlbumContentCoverPreview,
  type AlbumContentPreview,
} from '@/renderer/components/albums/AlbumContentCover';
import { cn } from '@/renderer/lib/utils';
import {
  getMediaStackHorizontalBounds,
  getMediaStackLayout,
  getMediaStackPrimaryFrameBounds,
  MediaStackPreview,
  type MediaStackItem,
} from '@/renderer/components/media/MediaStackPreview';
import { CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Button } from '@/renderer/components/ui/button';
import { TREE_BRANCH_INTERACTION } from '@/renderer/components/albums/treeBranchInteraction';
import { TreeBranchNodeConnector, TreeDisclosureRail } from '@/renderer/components/albums/TreeDisclosureRail';
import {
  COMPACT_TREE_NODE_METRICS,
  CREATION_TREE_COMPACT_NODE_METRICS,
  getTreeNodeAnchor,
  TREE_CONNECTION_GEOMETRY,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import { useTreeBranchPreviewGesture } from '@/renderer/components/albums/useTreeBranchPreviewGesture';

export type AlbumTreeOverlayStyle = 'blurred' | 'solid';

interface Props {
  size?: 'tree' | 'creation-tree';
  assets: AssetDto[];
  contentPreviews?: readonly AlbumContentPreview[];
  title: string;
  open: boolean;
  previewExpanded?: boolean;
  animate?: boolean;
  expandable: boolean;
  compact?: boolean;
  expandLabel: string;
  overlayStyle?: AlbumTreeOverlayStyle;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onDoubleClick: MouseEventHandler<HTMLButtonElement>;
  onAssetSelect?(asset: AssetDto): void;
  assetLabel?(asset: AssetDto, index: number): string;
  disclosureInteractive?: boolean;
  branchTopology?: TreeBranchItemTopology;
  onGestureExpand?(): void;
  onPointerTrackStart?(clientY: number): void;
  onPointerTrack?(clientY: number): boolean;
  onMediaAdmitted?(): void;
  className?: string;
}

function albumTreePreviewMetrics(size: NonNullable<Props['size']>, items: MediaStackItem[], compactIcon: boolean) {
  const compactMetrics = size === 'creation-tree' ? CREATION_TREE_COMPACT_NODE_METRICS : COMPACT_TREE_NODE_METRICS;
  const layout = getMediaStackLayout(size);
  const bounds = compactIcon ? compactMetrics.bounds : getMediaStackPrimaryFrameBounds(size, items, ALBUM_COVER_LAYERS);
  const expandedBounds = getMediaStackHorizontalBounds(
    size,
    items,
    'expanded',
    ALBUM_COVER_LAYERS,
    TREE_BRANCH_INTERACTION.previewSpreadStepPx,
  );
  // Creation covers may overlap their own title; other trees retain their reserved fan width.
  const mediaWidth =
    size === 'creation-tree' ? layout.containerWidth : Math.ceil(Math.max(layout.containerWidth, expandedBounds.right));
  return {
    previewWidth: compactIcon ? compactMetrics.width : mediaWidth,
    rowHeight: compactIcon ? TREE_CONNECTION_GEOMETRY.compactRowHeight : TREE_CONNECTION_GEOMETRY.rowHeight,
    nodeAnchor: getTreeNodeAnchor(bounds, compactIcon ? 0 : undefined),
    gestureSurfaceLeft: Math.min(0, expandedBounds.left),
    gestureSurfaceRight: Math.max(layout.containerWidth, expandedBounds.right),
  };
}

export function AlbumCoverBadge({
  compact = false,
  overlayStyle = 'blurred',
  label,
  onClick,
  onDoubleClick,
}: {
  compact?: boolean;
  overlayStyle?: AlbumTreeOverlayStyle;
  label?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onDoubleClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  const className = cn(
    'absolute z-30 grid place-items-center bg-overlay/95 text-selected-foreground',
    overlayStyle === 'blurred' ? 'rounded-md border shadow-overlay backdrop-blur-sm' : 'rounded-sm',
    compact ? 'bottom-0.5 left-0.5 size-4' : 'right-0.5 bottom-0.5 size-5',
  );
  const icon = <AlbumGlyphIcon className={compact ? 'size-3' : 'size-3.5'} />;

  if (!onClick) {
    return (
      <span aria-hidden="true" className={cn('pointer-events-none', className)}>
        {icon}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      className={cn(className, 'pointer-events-auto p-0 hover:bg-hover-strong focus-visible:ring-offset-0')}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick?.(event);
      }}
    >
      {icon}
    </Button>
  );
}

function AlbumTreePreviewCover({
  size,
  compactIcon,
  contentPreviews,
  title,
  animate,
  overlayStyle,
  onClick,
  onDoubleClick,
  onAssetSelect,
  children,
}: Pick<
  Props,
  'contentPreviews' | 'title' | 'animate' | 'overlayStyle' | 'onClick' | 'onDoubleClick' | 'onAssetSelect'
> & {
  size: NonNullable<Props['size']>;
  compactIcon: boolean;
  children: ReactNode;
}) {
  if (compactIcon && contentPreviews?.length) {
    return (
      <span className={cn('relative z-10', size === 'creation-tree' ? 'ml-7' : 'mx-1')}>
        <AlbumContentCoverPreview previews={contentPreviews} title={title} animate={animate} />
      </span>
    );
  }
  if (onAssetSelect && !compactIcon) {
    return (
      <span className="relative z-10 grid shrink-0 place-items-center rounded-lg">
        <button
          type="button"
          className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          aria-label={title}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        />
        {children}
        {size !== 'creation-tree' && (
          <AlbumCoverBadge label={title} overlayStyle={overlayStyle} onClick={onClick} onDoubleClick={onDoubleClick} />
        )}
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      className="relative z-10 grid size-auto shrink-0 place-items-center rounded-sm p-0 outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      aria-label={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
      {!compactIcon && size !== 'creation-tree' && <AlbumCoverBadge overlayStyle={overlayStyle} />}
    </Button>
  );
}

/**
 * Shared album cover/disclosure geometry for material and creator trees.
 * The cover is allowed to cross the row's visual inset by a couple of pixels;
 * the disclosure curve is attached to that cover rather than laid out beside it.
 */
export function AlbumTreePreview({
  size = 'tree',
  assets,
  contentPreviews,
  title,
  open,
  previewExpanded: controlledPreviewExpanded,
  animate = true,
  expandable,
  compact = false,
  expandLabel,
  overlayStyle = 'blurred',
  onClick,
  onDoubleClick,
  onAssetSelect,
  assetLabel,
  disclosureInteractive = true,
  branchTopology,
  onGestureExpand,
  onPointerTrackStart,
  onPointerTrack,
  onMediaAdmitted,
  className,
}: Props) {
  const stackItems: MediaStackItem[] = albumCoverAssets(assets, ALBUM_COVER_LAYERS).map((asset) => ({ asset }));
  const compactIcon = compact && stackItems.length === 0;
  const canSpreadCover = stackItems.length > 1;
  const previewGesture = useTreeBranchPreviewGesture({
    open,
    expandable,
    canSpreadPreview: canSpreadCover,
    onGestureExpand,
    onPointerTrackStart,
    onPointerTrack,
  });
  const previewExpanded = controlledPreviewExpanded ?? previewGesture.previewExpanded;
  const spread = previewExpanded ? 'expanded' : open ? 'settled' : 'collapsed';
  const { previewWidth, rowHeight, nodeAnchor, gestureSurfaceLeft, gestureSurfaceRight } = albumTreePreviewMetrics(
    size,
    stackItems,
    compactIcon,
  );

  const mediaStack = compactIcon ? (
    <span
      className={cn('grid size-7 place-items-center text-muted-foreground', size === 'creation-tree' ? 'ml-7' : 'mx-1')}
    >
      <AlbumContentCover previews={contentPreviews} />
    </span>
  ) : (
    <MediaStackPreview
      className={onAssetSelect ? 'pointer-events-none relative z-10' : undefined}
      size={size}
      items={stackItems}
      emptyContent={<span aria-hidden="true" />}
      spread={spread}
      maxItems={ALBUM_COVER_LAYERS}
      expandedStep={TREE_BRANCH_INTERACTION.previewSpreadStepPx}
      animate={animate}
      onAssetSelect={onAssetSelect}
      assetLabel={assetLabel}
      deferOffscreenMedia
      onMediaAdmitted={onMediaAdmitted}
      badge={
        size === 'creation-tree' ? (
          <AlbumCoverBadge
            overlayStyle={overlayStyle}
            {...(onAssetSelect ? { label: title, onClick, onDoubleClick } : {})}
          />
        ) : undefined
      }
    />
  );

  return (
    <span
      data-album-tree-preview
      data-stack-expanded={spread}
      role="group"
      aria-label={title}
      className={cn(
        'relative -ml-1 flex shrink-0 items-center overflow-visible',
        size === 'creation-tree' ? 'z-20' : 'z-10',
        previewExpanded && 'z-30',
        'has-[[data-content-expanded=true]]:z-30',
        className,
      )}
      style={{ width: previewWidth, height: rowHeight }}
      {...previewGesture.bindings}
    >
      {branchTopology && (
        <TreeBranchNodeConnector topology={branchTopology} anchor={nodeAnchor} rowHeight={rowHeight} />
      )}
      {size === 'tree' && (open || previewExpanded) && canSpreadCover && (
        <span
          data-album-cover-gesture-surface
          className="absolute inset-y-0 z-0"
          style={{ left: gestureSurfaceLeft, width: gestureSurfaceRight - gestureSurfaceLeft }}
          aria-hidden="true"
        />
      )}
      {expandable &&
        (disclosureInteractive ? (
          <CollapsibleTrigger asChild>
            <TreeDisclosureRail attached open={open} label={expandLabel} anchor={nodeAnchor} rowHeight={rowHeight} />
          </CollapsibleTrigger>
        ) : (
          <TreeDisclosureRail
            attached
            open={open}
            label={expandLabel}
            anchor={nodeAnchor}
            rowHeight={rowHeight}
            className="pointer-events-none"
            tabIndex={-1}
            aria-hidden="true"
          />
        ))}
      <AlbumTreePreviewCover
        size={size}
        compactIcon={compactIcon}
        contentPreviews={contentPreviews}
        title={title}
        animate={animate}
        overlayStyle={overlayStyle}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onAssetSelect={onAssetSelect}
      >
        {mediaStack}
      </AlbumTreePreviewCover>
    </span>
  );
}
