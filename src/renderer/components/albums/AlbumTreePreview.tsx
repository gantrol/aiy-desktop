import { useRef, useState, type MouseEventHandler } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { AlbumGlyphIcon } from '@/renderer/icons';
import { cn } from '@/renderer/lib/utils';
import {
  getMediaStackHorizontalBounds,
  getMediaStackLayout,
  getMediaStackPrimaryFrameBounds,
  MediaStackPreview,
  type MediaStackItem,
} from '@/renderer/components/media/MediaStackPreview';
import { CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { useHoverIntent } from '@/renderer/components/ui/use-hover-intent';
import {
  ALBUM_TREE_INTERACTION,
  shouldExpandAlbumFromPullDown,
} from '@/renderer/components/albums/albumTreeInteraction';
import { TreeBranchNodeConnector, TreeDisclosureRail } from '@/renderer/components/albums/TreeDisclosureRail';
import { getTreeNodeAnchor, type TreeBranchItemTopology } from '@/renderer/components/albums/treeConnectionGeometry';

interface Props {
  assets: AssetDto[];
  title: string;
  open: boolean;
  expandable: boolean;
  expandLabel: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onDoubleClick: MouseEventHandler<HTMLButtonElement>;
  disclosureInteractive?: boolean;
  branchTopology?: TreeBranchItemTopology;
  onPullDownExpand?(): void;
  onPointerTrackStart?(clientY: number): void;
  onPointerTrack?(clientY: number): boolean;
  className?: string;
}

export function AlbumCoverBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute z-30 grid place-items-center border bg-overlay/95 text-selected-foreground shadow-overlay backdrop-blur-sm',
        compact ? 'bottom-0.5 left-0.5 size-4 rounded-[5px]' : 'right-0.5 bottom-0.5 size-5 rounded-md',
      )}
    >
      <AlbumGlyphIcon className={compact ? 'size-3' : 'size-3.5'} />
    </span>
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
  expandable,
  expandLabel,
  onClick,
  onDoubleClick,
  disclosureInteractive = true,
  branchTopology,
  onPullDownExpand,
  onPointerTrackStart,
  onPointerTrack,
  className,
}: Props) {
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const pointerStartY = useRef<number | null>(null);
  const pointerCurrentY = useRef<number | null>(null);
  const pullDownArmed = useRef(false);
  const pullDownTriggered = useRef(false);
  const gestureOpen = useRef(open);
  const pullDownIntent = useHoverIntent(ALBUM_TREE_INTERACTION.pullDownArmDelayMs);
  gestureOpen.current = open;
  const stackItems: MediaStackItem[] = assets.map((asset) => ({ asset }));
  const canSpreadCover = stackItems.length > 1;
  const spread = previewExpanded ? 'expanded' : open ? 'settled' : 'collapsed';
  const nodeAnchor = getTreeNodeAnchor(getMediaStackPrimaryFrameBounds('tree', stackItems, 5));
  const expandedBounds = getMediaStackHorizontalBounds(
    'tree',
    stackItems,
    'expanded',
    5,
    ALBUM_TREE_INTERACTION.hoverSpreadStepPx,
  );
  const paintedBounds = getMediaStackHorizontalBounds(
    'tree',
    stackItems,
    spread,
    5,
    ALBUM_TREE_INTERACTION.hoverSpreadStepPx,
  );
  const previewWidth = Math.ceil(Math.max(getMediaStackLayout('tree').containerWidth, paintedBounds.right));
  const gestureSurfaceLeft = Math.min(0, expandedBounds.left);
  const gestureSurfaceRight = Math.max(getMediaStackLayout('tree').containerWidth, expandedBounds.right);

  function tryPullDownExpand() {
    if (
      pullDownTriggered.current ||
      pointerStartY.current === null ||
      pointerCurrentY.current === null ||
      !shouldExpandAlbumFromPullDown({
        armed: pullDownArmed.current,
        originY: pointerStartY.current,
        currentY: pointerCurrentY.current,
      }) ||
      !expandable ||
      gestureOpen.current ||
      !onPullDownExpand
    )
      return false;

    pullDownTriggered.current = true;
    gestureOpen.current = true;
    onPullDownExpand();
    return true;
  }

  function trackCoverPointer(clientY: number) {
    pointerCurrentY.current = clientY;
    if (onPointerTrack?.(clientY)) {
      gestureOpen.current = false;
      pointerStartY.current = clientY;
      pullDownTriggered.current = false;
    }
    tryPullDownExpand();
  }

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
      onPointerEnter={(event) => {
        pointerStartY.current = event.clientY;
        pointerCurrentY.current = event.clientY;
        pullDownArmed.current = false;
        pullDownTriggered.current = false;
        onPointerTrackStart?.(event.clientY);
        pullDownIntent.schedule(
          () => {
            pullDownArmed.current = true;
            tryPullDownExpand();
          },
          expandable && Boolean(onPullDownExpand),
        );
      }}
      onPointerMove={(event) => trackCoverPointer(event.clientY)}
      onPointerLeave={(event) => {
        trackCoverPointer(event.clientY);
        pullDownIntent.cancel();
        pullDownArmed.current = false;
      }}
      onMouseEnter={() => setPreviewExpanded(canSpreadCover)}
      onMouseLeave={() => {
        pullDownIntent.cancel();
        pointerStartY.current = null;
        pointerCurrentY.current = null;
        pullDownArmed.current = false;
        pullDownTriggered.current = false;
        setPreviewExpanded(false);
      }}
      onFocusCapture={() => setPreviewExpanded(canSpreadCover)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPreviewExpanded(false);
      }}
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
      <button
        type="button"
        className="relative z-10 grid shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        aria-label={title}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        <MediaStackPreview
          size="tree"
          items={stackItems}
          spread={spread}
          maxItems={5}
          expandedStep={ALBUM_TREE_INTERACTION.hoverSpreadStepPx}
        />
        <AlbumCoverBadge />
      </button>
    </span>
  );
}
