import { forwardRef, type ComponentProps, type DragEvent, type ReactNode } from 'react';
import { TreeBranchNodeConnector, TreeBranchTransitRail } from '@/renderer/components/albums/TreeDisclosureRail';
import { getTreeNodeAnchor, type TreeBranchItemTopology } from '@/renderer/components/albums/treeConnectionGeometry';
import {
  getMediaStackHorizontalBounds,
  getMediaStackLayout,
  getMediaStackPrimaryFrameBounds,
  type MediaStackItem,
  type MediaStackPrimaryFrameBounds,
} from '@/renderer/components/media/MediaStackPreview';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import { useTreeBranchPreviewGesture } from '@/renderer/components/albums/useTreeBranchPreviewGesture';

export interface CreationLibraryTreePlacementProps {
  branchTopology?: TreeBranchItemTopology;
}

export interface CreationLibraryTreeDragProps {
  onDragStart?(event: DragEvent): void;
  onDragEnd?(): void;
}

export interface CreationTreeChildBranch {
  open: boolean;
}

export interface CreationTreeNodeFrameProps
  extends CreationLibraryTreePlacementProps, Omit<ComponentProps<'span'>, 'children'> {
  bounds: MediaStackPrimaryFrameBounds;
  rowInsetY?: number;
  children: ReactNode;
}

/** Shared tree bus and node junction for every creation-library item preview. */
export function CreationTreeNodeFrame({
  bounds,
  rowInsetY,
  branchTopology,
  className,
  style,
  children,
  ...props
}: CreationTreeNodeFrameProps) {
  const anchor = getTreeNodeAnchor(bounds, rowInsetY);
  return (
    <span
      {...props}
      data-creation-tree-node-frame
      className={cn('relative z-10 shrink-0 overflow-visible', className)}
      style={style}
    >
      {branchTopology && <TreeBranchTransitRail topology={branchTopology} />}
      {branchTopology && <TreeBranchNodeConnector topology={branchTopology} anchor={anchor} />}
      {children}
    </span>
  );
}

export function getCreationTreeMediaNodeMetrics(items: readonly MediaStackItem[], maxItems = 3) {
  const paintedBounds = getMediaStackHorizontalBounds('tree', items, 'settled', maxItems);
  return {
    bounds: getMediaStackPrimaryFrameBounds('tree', items, maxItems),
    width: Math.ceil(Math.max(getMediaStackLayout('tree').containerWidth, paintedBounds.right)),
  };
}

export type CreationLibraryTreeDataAttributes = Partial<
  Record<`data-${string}`, string | number | boolean | undefined>
>;

export interface CreationLibraryTreeItemProps
  extends CreationLibraryTreePlacementProps, Omit<ComponentProps<'div'>, 'children' | 'title' | 'onSelect'> {
  selected: boolean;
  ariaLabel: string;
  openLabel: string;
  title: string;
  metadata?: ReactNode;
  preview: ReactNode | ((expanded: boolean) => ReactNode);
  previewBounds: MediaStackPrimaryFrameBounds;
  canSpreadPreview?: boolean;
  childBranch?: CreationTreeChildBranch;
  previewClassName?: string;
  previewStyle?: ComponentProps<'span'>['style'];
  leadingContent?: ReactNode;
  controls?: ReactNode;
  titleClassName?: string;
  dataAttributes?: CreationLibraryTreeDataAttributes;
  onGestureExpand?(): void;
  onPointerTrackStart?(clientY: number): void;
  onPointerTrack?(clientY: number): boolean;
  onOpen(): void;
}

/** Common 68px directory row; content types supply only preview, metadata and actions. */
export const CreationLibraryTreeItem = forwardRef<HTMLDivElement, CreationLibraryTreeItemProps>(
  function CreationLibraryTreeItem(
    {
      selected,
      ariaLabel,
      openLabel,
      title,
      metadata,
      preview,
      previewBounds,
      canSpreadPreview = false,
      childBranch,
      previewClassName,
      previewStyle,
      leadingContent,
      controls,
      branchTopology,
      className,
      titleClassName,
      dataAttributes,
      onGestureExpand,
      onPointerTrackStart,
      onPointerTrack,
      onOpen,
      ...props
    },
    ref,
  ) {
    const previewGesture = useTreeBranchPreviewGesture({
      open: childBranch?.open ?? false,
      expandable: Boolean(childBranch),
      canSpreadPreview,
      onGestureExpand: childBranch ? onGestureExpand : undefined,
      onPointerTrackStart: childBranch ? onPointerTrackStart : undefined,
      onPointerTrack: childBranch ? onPointerTrack : undefined,
    });

    return (
      <div
        {...props}
        ref={ref}
        {...dataAttributes}
        data-result-library-selected={selected ? 'true' : undefined}
        role="group"
        aria-label={ariaLabel}
        className={cn(
          'group relative flex h-[4.25rem] min-w-0 cursor-pointer items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover',
          selected &&
            'text-selected-foreground before:pointer-events-none before:absolute before:inset-y-0.5 before:left-3 before:right-0 before:rounded-xl before:bg-selected hover:bg-transparent',
          className,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          aria-label={openLabel}
          aria-current={selected ? 'page' : undefined}
          className="absolute inset-0 z-0 size-auto rounded-lg p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={onOpen}
        />
        <CreationTreeNodeFrame
          bounds={previewBounds}
          branchTopology={branchTopology}
          className={cn(
            '-ml-1 flex h-[4.25rem] w-16 items-center',
            childBranch ? 'pointer-events-auto' : 'pointer-events-none',
            previewClassName,
          )}
          style={previewStyle}
          {...(childBranch ? previewGesture.bindings : {})}
          onClick={childBranch ? onOpen : undefined}
        >
          {typeof preview === 'function' ? preview(previewGesture.previewExpanded) : preview}
        </CreationTreeNodeFrame>
        {leadingContent}
        <span className="pointer-events-none relative z-10 min-w-0 flex-1 px-1 text-left">
          <strong
            className={cn('line-clamp-2 break-words text-base font-medium leading-5', titleClassName)}
            title={title}
          >
            {title}
          </strong>
          {metadata}
        </span>
        {controls}
      </div>
    );
  },
);

CreationLibraryTreeItem.displayName = 'CreationLibraryTreeItem';
