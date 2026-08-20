import { useEffect, useRef, useState } from 'react';
import type { AssetDto, AssetFileRevealContext } from '@/shared/contracts';
import { ImageIcon } from '@/renderer/icons';
import { cn } from '@/renderer/lib/utils';
import { getSourceMediaAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { AssetMedia, isVideoAsset } from '@/renderer/components/media/AssetMedia';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import {
  stackedMediaFrameLayerClassName,
  stackedMediaFrameLiftClassName,
  stackedMediaFrameStyle,
} from '@/renderer/components/ui/stacked-media-frame';

export interface MediaStackItem {
  asset: AssetDto;
  focalX?: number;
  focalY?: number;
  revealContext?: AssetFileRevealContext;
}

interface Props {
  items: MediaStackItem[];
  size?: 'xs' | 'rail' | 'tree' | 'sm' | 'md' | 'card';
  className?: string;
  expanded?: boolean;
  spread?: MediaStackSpread;
  maxItems?: number;
  expandedStep?: number;
  singleItemAlign?: 'center' | 'end';
  onExpandedChange?(expanded: boolean): void;
  onAssetSelect?(asset: AssetDto): void;
  onAssetPreviewChange?(asset: AssetDto | null): void;
  assetLabel?(asset: AssetDto, index: number): string;
  notify?(message: string): void;
  contextActions?: readonly ActionMenuAction[];
  revealContext?: AssetFileRevealContext;
  deferOffscreenMedia?: boolean;
  onMediaAdmitted?(): void;
}

export type MediaStackSpread = 'collapsed' | 'settled' | 'expanded';

interface MediaStackLayout {
  containerWidth: number;
  containerHeight: number;
  itemWidth: number;
  itemHeight: number;
  singleItemWidth?: number;
  singleItemHeight?: number;
  collapsedStep: number;
  settledStep: number;
  expandedStep: number;
}

const dimensions: Record<NonNullable<Props['size']>, MediaStackLayout> = {
  xs: {
    containerWidth: 44,
    containerHeight: 38,
    itemWidth: 25,
    itemHeight: 34,
    collapsedStep: 6,
    settledStep: 8,
    expandedStep: 10,
  },
  rail: {
    containerWidth: 60,
    containerHeight: 60,
    itemWidth: 46,
    itemHeight: 52,
    singleItemWidth: 56,
    singleItemHeight: 56,
    collapsedStep: 5,
    settledStep: 6,
    expandedStep: 7,
  },
  tree: {
    containerWidth: 64,
    containerHeight: 60,
    itemWidth: 45,
    itemHeight: 60,
    collapsedStep: 7,
    settledStep: 11,
    expandedStep: 20,
  },
  sm: {
    containerWidth: 62,
    containerHeight: 50,
    itemWidth: 34,
    itemHeight: 46,
    collapsedStep: 6,
    settledStep: 10,
    expandedStep: 14,
  },
  md: {
    containerWidth: 78,
    containerHeight: 64,
    itemWidth: 42,
    itemHeight: 58,
    collapsedStep: 6,
    settledStep: 12,
    expandedStep: 18,
  },
  card: {
    containerWidth: 236,
    containerHeight: 152,
    itemWidth: 88,
    itemHeight: 132,
    collapsedStep: 10,
    settledStep: 16,
    expandedStep: 24,
  },
};

export function getMediaStackLayout(size: NonNullable<Props['size']>) {
  return dimensions[size];
}

export interface MediaStackPrimaryFrameBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function fittedFrame(asset: AssetDto, maxWidth: number, maxHeight: number) {
  const ratio = getSourceMediaAspectRatio(asset.width, asset.height, maxWidth / maxHeight);
  return ratio >= maxWidth / maxHeight
    ? { width: maxWidth, height: maxWidth / ratio }
    : { width: maxHeight * ratio, height: maxHeight };
}

function fittedStackFrame(asset: AssetDto, layout: MediaStackLayout, itemCount: number) {
  return fittedFrame(
    asset,
    itemCount === 1 ? (layout.singleItemWidth ?? layout.itemWidth) : layout.itemWidth,
    itemCount === 1 ? (layout.singleItemHeight ?? layout.itemHeight) : layout.itemHeight,
  );
}

/**
 * Stable, unrotated bounds for the first cover in a stack. Tree connections
 * attach here so the rail does not move when the remaining covers fan out.
 */
export function getMediaStackPrimaryFrameBounds(
  size: NonNullable<Props['size']>,
  items: readonly MediaStackItem[],
  maxItems = 3,
): MediaStackPrimaryFrameBounds {
  const visible = items.slice(0, maxItems);
  const layout = dimensions[size];
  if (!visible.length) {
    return { left: 4, top: 4, right: layout.containerWidth - 4, bottom: layout.containerHeight - 4 };
  }

  const frame = fittedStackFrame(visible[0].asset, layout, visible.length);
  const firstCenter = layout.containerWidth / 2 - ((visible.length - 1) / 2) * layout.collapsedStep;
  const left = visible.length === 1 ? layout.containerWidth - frame.width - 2 : firstCenter - frame.width / 2;
  const top = (layout.containerHeight - frame.height) / 2;
  return { left, top, right: left + frame.width, bottom: top + frame.height };
}

/**
 * The disclosure curve is drawn outside the stack, so expose the actual
 * left-most painted edge rather than approximating it from the item count.
 * The closed state includes the small fan rotation in its bounding box.
 */
export function getMediaStackHorizontalBounds(
  size: NonNullable<Props['size']>,
  items: readonly MediaStackItem[],
  spread: boolean | MediaStackSpread,
  maxItems = 3,
  expandedStep?: number,
) {
  const visible = items.slice(0, maxItems);
  const layout = dimensions[size];
  if (!visible.length) return { left: 4, right: layout.containerWidth - 4 };

  const spreadState = typeof spread === 'boolean' ? (spread ? 'expanded' : 'collapsed') : spread;
  const step =
    spreadState === 'expanded'
      ? (expandedStep ?? layout.expandedStep)
      : spreadState === 'settled'
        ? layout.settledStep
        : layout.collapsedStep;
  return visible.reduce(
    (bounds, item, index) => {
      const frame = fittedStackFrame(item.asset, layout, visible.length);
      const firstCenter = layout.containerWidth / 2 - ((visible.length - 1) / 2) * layout.collapsedStep;
      const centerX = visible.length === 1 ? layout.containerWidth - frame.width / 2 - 2 : firstCenter + index * step;
      const offset = index - (visible.length - 1) / 2;
      const rotation = spreadState === 'collapsed' && visible.length > 1 ? offset * 3 : 0;
      const radians = (Math.abs(rotation) * Math.PI) / 180;
      const rotatedWidth = Math.abs(frame.width * Math.cos(radians)) + Math.abs(frame.height * Math.sin(radians));
      return {
        left: Math.min(bounds.left, centerX - rotatedWidth / 2),
        right: Math.max(bounds.right, centerX + rotatedWidth / 2),
      };
    },
    { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY },
  );
}

export function getMediaStackLeadingEdge(
  size: NonNullable<Props['size']>,
  items: readonly MediaStackItem[],
  spread: boolean | MediaStackSpread,
  maxItems = 3,
) {
  return getMediaStackHorizontalBounds(size, items, spread, maxItems).left;
}

function useMediaStackAdmission(deferOffscreenMedia: boolean, onMediaAdmitted?: () => void) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const onMediaAdmittedRef = useRef(onMediaAdmitted);
  const [admitted, setAdmitted] = useState(() => !deferOffscreenMedia || typeof IntersectionObserver === 'undefined');
  onMediaAdmittedRef.current = onMediaAdmitted;

  useEffect(() => {
    if (admitted || !deferOffscreenMedia) return;
    const container = containerRef.current;
    if (!container) return;
    const scrollViewport = container.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    // Native lazy images look several viewports ahead. Gate tree media on the
    // actually clipped scroll viewport so opening a deep branch stays incremental.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        onMediaAdmittedRef.current?.();
        setAdmitted(true);
        observer.disconnect();
      },
      { root: scrollViewport, rootMargin: '320px 0px' },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [admitted, deferOffscreenMedia]);

  return { containerRef, mediaAdmitted: admitted || !deferOffscreenMedia };
}

export function MediaStackPreview({
  items,
  size = 'md',
  className,
  expanded: controlledExpanded,
  spread: controlledSpread,
  maxItems = 3,
  expandedStep,
  singleItemAlign = 'end',
  onExpandedChange,
  onAssetSelect,
  onAssetPreviewChange,
  assetLabel,
  notify,
  contextActions,
  revealContext,
  deferOffscreenMedia = false,
  onMediaAdmitted,
}: Props) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const { containerRef, mediaAdmitted } = useMediaStackAdmission(deferOffscreenMedia, onMediaAdmitted);
  const expanded = controlledExpanded ?? internalExpanded;
  const spread = controlledSpread ?? (expanded ? 'expanded' : 'collapsed');
  const visible = items.slice(0, maxItems);
  const layout = dimensions[size];
  const thumbnailSize = size === 'xs' || size === 'sm' ? 96 : 160;
  const frames = visible.map((item) => fittedStackFrame(item.asset, layout, visible.length));

  function updateExpanded(next: boolean) {
    if (controlledExpanded === undefined) setInternalExpanded(next);
    onExpandedChange?.(next);
  }

  return (
    <span
      ref={containerRef}
      data-media-stack
      data-media-count={items.length}
      data-expanded={spread === 'expanded' ? 'true' : 'false'}
      data-spread={spread}
      className={cn(
        'relative inline-block shrink-0 rounded-lg',
        size === 'tree' ? 'overflow-visible' : 'overflow-hidden',
        className,
      )}
      style={{ width: layout.containerWidth, height: layout.containerHeight }}
      onMouseEnter={() => updateExpanded(true)}
      onMouseLeave={() => {
        updateExpanded(false);
        onAssetPreviewChange?.(null);
      }}
      onFocusCapture={() => updateExpanded(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          updateExpanded(false);
          onAssetPreviewChange?.(null);
        }
      }}
    >
      {!visible.length && (
        <span
          className={cn(
            'absolute inset-1 grid place-items-center rounded-md border bg-surface-sunken text-muted-foreground',
            size === 'tree' && 'corner-continuous',
          )}
        >
          <ImageIcon className={size === 'sm' ? 'size-4' : 'size-5'} />
        </span>
      )}
      {visible.map((item, index) => {
        const frame = frames[index];
        const offset = index - (visible.length - 1) / 2;
        const singleX =
          singleItemAlign === 'center'
            ? (layout.containerWidth - frame.width) / 2
            : layout.containerWidth - frame.width - 2;
        const firstCenter = layout.containerWidth / 2 - ((visible.length - 1) / 2) * layout.collapsedStep;
        const collapsedX =
          visible.length === 1 ? singleX : firstCenter + index * layout.collapsedStep - frame.width / 2;
        const settledX = visible.length === 1 ? singleX : firstCenter + index * layout.settledStep - frame.width / 2;
        const expandedX =
          visible.length === 1
            ? singleX
            : firstCenter + index * (expandedStep ?? layout.expandedStep) - frame.width / 2;
        const x = spread === 'expanded' ? expandedX : spread === 'settled' ? settledX : collapsedX;
        const rotation = spread === 'collapsed' && visible.length > 1 ? offset * 3 : 0;
        const frameStyle = stackedMediaFrameStyle(visible.length - index, {
          top: (layout.containerHeight - frame.height) / 2,
          width: frame.width,
          height: frame.height,
          transform: `translateX(${x}px) rotate(${rotation}deg)`,
        });
        const mediaStyle = { objectPosition: `${(item.focalX ?? 0.5) * 100}% ${(item.focalY ?? 0.5) * 100}%` };
        const image = !mediaAdmitted ? null : isVideoAsset(item.asset) ? (
          <AssetMedia
            asset={item.asset}
            className="size-full object-contain"
            loading="lazy"
            muted
            preload="metadata"
            draggable={false}
          />
        ) : (
          <img
            className="size-full object-contain"
            src={mediaThumbnailUrl(item.asset, thumbnailSize)}
            alt=""
            loading="lazy"
            decoding="async"
            fetchPriority={index === 0 ? 'auto' : 'low'}
            draggable={false}
            style={mediaStyle}
          />
        );
        const preview = onAssetSelect ? (
          <button
            key={item.asset.id}
            type="button"
            aria-label={assetLabel?.(item.asset, index) ?? `Image ${index + 1}`}
            className={cn(
              'pointer-events-auto absolute left-0 overflow-hidden rounded-md border border-border/70 bg-surface-sunken outline-none transition-transform duration-fast ease-out motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              stackedMediaFrameLayerClassName,
              stackedMediaFrameLiftClassName,
              size === 'tree' && 'corner-continuous',
            )}
            style={frameStyle}
            onMouseEnter={() => onAssetPreviewChange?.(item.asset)}
            onFocus={() => onAssetPreviewChange?.(item.asset)}
            onClick={(event) => {
              event.stopPropagation();
              onAssetSelect(item.asset);
            }}
          >
            {image}
          </button>
        ) : (
          <span
            key={item.asset.id}
            className={cn(
              'absolute left-0 overflow-hidden rounded-md border border-border/70 bg-surface-sunken transition-transform duration-fast ease-out motion-reduce:transition-none',
              stackedMediaFrameLayerClassName,
              size === 'tree' && 'corner-continuous',
            )}
            style={frameStyle}
            aria-hidden="true"
          >
            {image}
          </span>
        );
        return notify ? (
          <AssetFileContextMenu
            key={item.asset.id}
            assetId={item.asset.id}
            notify={notify}
            actions={contextActions}
            revealContext={item.revealContext ?? revealContext}
          >
            {preview}
          </AssetFileContextMenu>
        ) : (
          preview
        );
      })}
    </span>
  );
}
