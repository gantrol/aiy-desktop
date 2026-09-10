import type { MouseEventHandler } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { AlbumGlyphIcon } from '@/renderer/icons';
import { AiyIdentity } from '@/renderer/components/brand/AiyIdentity';
import { cn } from '@/renderer/lib/utils';
import {
  getMediaStackHorizontalBounds,
  getMediaStackLayout,
  getMediaStackPrimaryFrameBounds,
  MediaStackPreview,
  type MediaStackItem,
} from '@/renderer/components/media/MediaStackPreview';
import { CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { TREE_BRANCH_INTERACTION } from '@/renderer/components/albums/treeBranchInteraction';
import { TreeBranchNodeConnector, TreeDisclosureRail } from '@/renderer/components/albums/TreeDisclosureRail';
import { getTreeNodeAnchor, type TreeBranchItemTopology } from '@/renderer/components/albums/treeConnectionGeometry';
import { useTreeBranchPreviewGesture } from '@/renderer/components/albums/useTreeBranchPreviewGesture';

export type AlbumTreeOverlayStyle = 'blurred' | 'solid';

interface Props {
  assets: AssetDto[];
  title: string;
  open: boolean;
  previewExpanded?: boolean;
  animate?: boolean;
  expandable: boolean;
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
    'absolute z-30 grid place-items-center border bg-overlay/95 text-selected-foreground shadow-overlay',
    overlayStyle === 'blurred' && 'backdrop-blur-sm',
    compact ? 'bottom-0.5 left-0.5 size-4 rounded-[5px]' : 'right-0.5 bottom-0.5 size-5 rounded-md',
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
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        className,
        'pointer-events-auto outline-none transition-colors hover:bg-hover-strong focus-visible:ring-2 focus-visible:ring-ring',
      )}
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
    </button>
  );
}

/**
 * Shared album cover/disclosure geometry for material and creator trees.
 * The cover is allowed to cross the row's visual inset by a couple of pixels;
 * the disclosure curve is attached to that cover rather than laid out beside it.
 */
export function AlbumTreePreview({
  assets,
  title,
  open,
  previewExpanded: controlledPreviewExpanded,
  animate = true,
  expandable,
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
  const stackItems: MediaStackItem[] = assets.map((asset) => ({ asset }));
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
  const nodeAnchor = getTreeNodeAnchor(getMediaStackPrimaryFrameBounds('tree', stackItems, 5));
  const expandedBounds = getMediaStackHorizontalBounds(
    'tree',
    stackItems,
    'expanded',
    5,
    TREE_BRANCH_INTERACTION.previewSpreadStepPx,
  );
  const paintedBounds = getMediaStackHorizontalBounds(
    'tree',
    stackItems,
    spread,
    5,
    TREE_BRANCH_INTERACTION.previewSpreadStepPx,
  );
  const previewWidth = Math.ceil(Math.max(getMediaStackLayout('tree').containerWidth, paintedBounds.right));
  const gestureSurfaceLeft = Math.min(0, expandedBounds.left);
  const gestureSurfaceRight = Math.max(getMediaStackLayout('tree').containerWidth, expandedBounds.right);

  const mediaStack = (
    <MediaStackPreview
      className={onAssetSelect ? 'pointer-events-none relative z-10' : undefined}
      size="tree"
      items={stackItems}
      emptyContent={<AiyIdentity className="size-full" />}
      spread={spread}
      maxItems={5}
      expandedStep={TREE_BRANCH_INTERACTION.previewSpreadStepPx}
      animate={animate}
      onAssetSelect={onAssetSelect}
      assetLabel={assetLabel}
      deferOffscreenMedia
      onMediaAdmitted={onMediaAdmitted}
    />
  );

  return (
    <span
      data-album-tree-preview
      data-stack-expanded={spread}
      role="group"
      aria-label={title}
      className={cn(
        'relative z-10 -ml-1 flex h-[68px] shrink-0 items-center overflow-visible',
        previewExpanded && 'z-30',
        className,
      )}
      style={{ width: previewWidth }}
      {...previewGesture.bindings}
    >
      {branchTopology && <TreeBranchNodeConnector topology={branchTopology} anchor={nodeAnchor} />}
      {(open || previewExpanded) && canSpreadCover && (
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
            <TreeDisclosureRail attached open={open} label={expandLabel} anchor={nodeAnchor} />
          </CollapsibleTrigger>
        ) : (
          <TreeDisclosureRail
            attached
            open={open}
            label={expandLabel}
            anchor={nodeAnchor}
            className="pointer-events-none"
            tabIndex={-1}
            aria-hidden="true"
          />
        ))}
      {onAssetSelect ? (
        <span className="relative z-10 grid shrink-0 place-items-center rounded-lg">
          <button
            type="button"
            className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            aria-label={title}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
          />
          {mediaStack}
          <AlbumCoverBadge label={title} overlayStyle={overlayStyle} onClick={onClick} onDoubleClick={onDoubleClick} />
        </span>
      ) : (
        <button
          type="button"
          className="relative z-10 grid shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          aria-label={title}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        >
          {mediaStack}
          <AlbumCoverBadge overlayStyle={overlayStyle} />
        </button>
      )}
    </span>
  );
}
