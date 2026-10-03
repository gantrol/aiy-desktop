import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AssetDto, AssetFileRevealContext } from '@/shared/contracts';
import { ImageIcon } from '@/renderer/icons';
import { cn } from '@/renderer/lib/utils';
import { getSourceMediaAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
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
  size?: 'xs' | 'rail' | 'tree' | 'creation-tree' | 'sm' | 'md' | 'card';
  className?: string;
  emptyContent?: ReactNode;
  /** Type or collection badge anchored to the first image's actual frame. */
  badge?: ReactNode;
  expanded?: boolean;
  animate?: boolean;
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
  trailingInset?: number;
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
    itemHeight: 56,
    collapsedStep: 4,
    settledStep: 6,
    expandedStep: 14,
  },
  'creation-tree': {
    containerWidth: 56,
    containerHeight: 60,
    itemWidth: 48,
    itemHeight: 56,
    collapsedStep: 2,
    settledStep: 2,
    expandedStep: 14,
    trailingInset: 4,
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

function stackFrameX(
  layout: MediaStackLayout,
  width: number,
  count: number,
  index: number,
  step: number,
  singleItemAlign: 'center' | 'end' = 'end',
) {
  // Keep the title column and cover-to-title gap stable without forcing a portrait frame.
  if (layout.trailingInset !== undefined) return layout.containerWidth - layout.trailingInset - width + index * step;
  if (count === 1)
    return singleItemAlign === 'center' ? (layout.containerWidth - width) / 2 : layout.containerWidth - width - 2;
  const firstCenter = layout.containerWidth / 2 - ((count - 1) / 2) * layout.collapsedStep;
  return firstCenter + index * step - width / 2;
}

function stackFrameRotation(size: NonNullable<Props['size']>, count: number, index: number, spread: MediaStackSpread) {
  if (spread !== 'collapsed' || count <= 1 || size === 'creation-tree') return 0;
  return size === 'tree' ? index * 1.2 : (index - (count - 1) / 2) * 3;
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
  const left = stackFrameX(layout, frame.width, visible.length, 0, layout.collapsedStep);
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
      const centerX = stackFrameX(layout, frame.width, visible.length, index, step) + frame.width / 2;
      const rotation = stackFrameRotation(size, visible.length, index, spreadState);
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
  emptyContent,
  badge,
  expanded: controlledExpanded,
  animate = true,
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
  const labels = useI18n().messages.gallery.albums;
  const [internalExpanded, setInternalExpanded] = useState(false);
  const { containerRef, mediaAdmitted } = useMediaStackAdmission(deferOffscreenMedia, onMediaAdmitted);
  const expanded = controlledExpanded ?? internalExpanded;
  const spread = controlledSpread ?? (expanded ? 'expanded' : 'collapsed');
  const visible = items.slice(0, maxItems);
  const layout = dimensions[size];
  const tree = size === 'tree' || size === 'creation-tree';
  const thumbnailSize = size === 'xs' || size === 'sm' ? 96 : 160;
  const frames = visible.map((item) => fittedStackFrame(item.asset, layout, visible.length));
  const badgeBounds = badge ? getMediaStackPrimaryFrameBounds(size, visible, maxItems) : null;

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
        tree ? 'overflow-visible' : 'overflow-hidden',
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
            'absolute inset-1 grid place-items-center overflow-hidden rounded-md border bg-surface-sunken text-muted-foreground',
            tree && 'corner-continuous',
          )}
        >
          {emptyContent ?? <ImageIcon className={size === 'sm' ? 'size-4' : 'size-5'} />}
        </span>
      )}
      {badgeBounds && (
        <span
          className="pointer-events-none absolute z-30"
          style={{
            left: badgeBounds.left,
            top: badgeBounds.top,
            width: badgeBounds.right - badgeBounds.left,
            height: badgeBounds.bottom - badgeBounds.top,
          }}
        >
          {badge}
        </span>
      )}
      {visible.map((item, index) => {
        const frame = frames[index];
        const step =
          spread === 'expanded'
            ? (expandedStep ?? layout.expandedStep)
            : spread === 'settled'
              ? layout.settledStep
              : layout.collapsedStep;
        const x = stackFrameX(layout, frame.width, visible.length, index, step, singleItemAlign);
        const rotation = stackFrameRotation(size, visible.length, index, spread);
        const frameStyle = stackedMediaFrameStyle(visible.length - index, {
          top: (layout.containerHeight - frame.height) / 2,
          width: frame.width,
          height: frame.height,
          transform: `translateX(${x}px) rotate(${rotation}deg)`,
          ...(!animate && { transition: 'none' }),
        });
        const mediaStyle = { objectPosition: `${(item.focalX ?? 0.5) * 100}% ${(item.focalY ?? 0.5) * 100}%` };
        const image = !mediaAdmitted ? null : (
          <AssetThumbnail
            asset={item.asset}
            errorClassName="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2"
            size={thumbnailSize}
            className="size-full object-contain"
            alt=""
            loading="lazy"
            fetchPriority={index === 0 ? 'auto' : 'low'}
            style={mediaStyle}
          />
        );
        const preview = onAssetSelect ? (
          <Button
            key={item.asset.id}
            type="button"
            variant="ghost"
            aria-label={assetLabel?.(item.asset, index) ?? labels.coverPreviewNumber(index + 1)}
            className={cn(
              'pointer-events-auto absolute left-0 overflow-hidden rounded-md bg-surface-sunken p-0 ring-1 ring-inset ring-foreground/10 outline-none transition-transform duration-fast ease-out hover:bg-surface-sunken motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0',
              stackedMediaFrameLayerClassName,
              stackedMediaFrameLiftClassName,
              tree && 'corner-continuous',
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
          </Button>
        ) : (
          <span
            key={item.asset.id}
            className={cn(
              'absolute left-0 overflow-hidden rounded-md bg-surface-sunken ring-1 ring-inset ring-foreground/10 transition-transform duration-fast ease-out motion-reduce:transition-none',
              stackedMediaFrameLayerClassName,
              tree && 'corner-continuous',
              size === 'creation-tree' && 'pointer-events-auto',
            )}
            style={frameStyle}
            aria-hidden="true"
          >
            {image}
          </span>
        );
        // Interactive covers keep their own file drag even inside a draggable library row.
        return notify || onAssetSelect ? (
          <AssetFileContextMenu
            key={item.asset.id}
            assetId={item.asset.id}
            inline
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
