import { ArchiveIcon, FolderOpenIcon, PinIcon, PinOffIcon, SquarePenIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import type { AssetDto, MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import {
  beginCreationCollectionDrag,
  beginMaterialAlbumDrag,
  endCreationCollectionDrag,
  endMaterialAlbumDrag,
  hasCreationCollectionDrag,
  hasExternalFilesDrag,
  hasMaterialsDrag,
  readCreationCollectionDrag,
  readMaterialAlbumDrag,
  readMaterialsDrag,
} from '@/renderer/components/albums/albumDrag';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { DEFAULT_MEDIA_ASPECT_RATIO, getSourceMediaAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import {
  ShortestColumnMasonry,
  type MasonryLayout,
  type MasonryPlacement,
} from '@/renderer/components/ui/shortest-column-masonry';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AlbumGlyphIcon } from '@/renderer/icons';
import { cn } from '@/renderer/lib/utils';

interface Props {
  albums: readonly MaterialAlbumDto[];
  title?: string;
  busy?: boolean;
  onOpen(albumId: string): void;
  canMoveCreationAlbum?: CanMoveAlbum;
  onMoveCreationAlbum?: MoveAlbum;
}

const MAX_PREVIEW_ASSETS = 5;
const DEFAULT_COLLECTION_ASPECT_RATIO = DEFAULT_MEDIA_ASPECT_RATIO;
export const COLLECTION_MIN_COLUMN_WIDTH = 240;
export const COLLECTION_GAP = 16;
const PREVIEW_THUMBNAIL_SIZE = 512;
const PREVIEW_BACKDROP_THUMBNAIL_SIZE = 256;
const MIN_COLLECTION_ASPECT_RATIO = 1 / 2;
const MAX_COLLECTION_ASPECT_RATIO = 2;
const PREVIEW_SPREAD_EDGE_RESERVE_RATIO = 0.14;

type PreviewSpreadDirection = 'left' | 'right';

export interface PreviewSpread {
  direction: PreviewSpreadDirection;
  maximumTranslation: number;
}

interface PreviewFrameBounds {
  aspectRatio: number;
  widthPercentage: number;
  heightPercentage: number;
}

export function collectionAspectRatio(asset: AssetDto | undefined) {
  const sourceAspectRatio = getSourceMediaAspectRatio(
    asset?.width ?? 0,
    asset?.height ?? 0,
    DEFAULT_COLLECTION_ASPECT_RATIO,
  );
  return Math.max(MIN_COLLECTION_ASPECT_RATIO, Math.min(MAX_COLLECTION_ASPECT_RATIO, sourceAspectRatio));
}

function previewNeedsEdgeFill(asset: AssetDto, frameAspectRatio: number) {
  const sourceAspectRatio = getSourceMediaAspectRatio(asset.width, asset.height, DEFAULT_COLLECTION_ASPECT_RATIO);
  return Math.abs(sourceAspectRatio - frameAspectRatio) > 0.001;
}

function previewFrameBounds(asset: AssetDto, containerAspectRatio: number): PreviewFrameBounds {
  const aspectRatio = collectionAspectRatio(asset);
  if (aspectRatio >= containerAspectRatio) {
    return {
      aspectRatio,
      widthPercentage: 100,
      heightPercentage: (containerAspectRatio / aspectRatio) * 100,
    };
  }
  return {
    aspectRatio,
    widthPercentage: (aspectRatio / containerAspectRatio) * 100,
    heightPercentage: 100,
  };
}

function defaultPreviewTranslation(count: number) {
  if (count <= 1) return 0;
  return count === 2 ? 62 : count === 3 ? 86 : 108;
}

export function previewSpreadForPlacement(
  count: number,
  placement: Readonly<MasonryPlacement>,
  layout: Readonly<MasonryLayout>,
): PreviewSpread {
  const desiredTranslation = defaultPreviewTranslation(count);
  if (!desiredTranslation || placement.width <= 0) return { direction: 'right', maximumTranslation: 0 };

  const layoutWidth = layout.columnCount * layout.columnWidth + (layout.columnCount - 1) * COLLECTION_GAP;
  const leftRoom = Math.max(0, placement.x);
  const rightRoom = Math.max(0, layoutWidth - placement.x - placement.width);
  const edgeReserve = Math.min(placement.width, placement.height) * PREVIEW_SPREAD_EDGE_RESERVE_RATIO;
  const desiredRoom = (placement.width * desiredTranslation) / 100 + edgeReserve;
  const direction: PreviewSpreadDirection = rightRoom >= desiredRoom || rightRoom >= leftRoom ? 'right' : 'left';
  const availableRoom = direction === 'right' ? rightRoom : leftRoom;
  const maximumTranslation = Math.min(
    desiredTranslation,
    (Math.max(0, availableRoom - edgeReserve) / placement.width) * 100,
  );

  return { direction, maximumTranslation };
}

function previewFrameStyle(
  index: number,
  count: number,
  expanded: boolean,
  hoveredIndex: number | null,
  spread: PreviewSpread,
  frame: PreviewFrameBounds,
): CSSProperties {
  const lifted = expanded && index === hoveredIndex;
  const direction = spread.direction === 'right' ? 1 : -1;
  const transformOrigin = spread.direction === 'right' ? '18% 94%' : '82% 94%';
  const horizontalTranslation = (percentage: number) => (percentage * 100) / frame.widthPercentage;
  const verticalTranslation = (percentage: number) => (percentage * 100) / frame.heightPercentage;
  const frameStyle: CSSProperties = {
    width: `${frame.widthPercentage}%`,
    height: `${frame.heightPercentage}%`,
  };

  if (index === 0 || count === 1) {
    return {
      ...frameStyle,
      zIndex: lifted ? count + 10 : count,
      transform: lifted
        ? `translate3d(0, ${verticalTranslation(-2)}%, 0) rotate(0deg) scale(1.025)`
        : 'translate3d(0, 0, 0) rotate(0deg) scale(1)',
      transformOrigin,
    };
  }

  if (expanded) {
    const progress = index / (count - 1);
    const translateX = horizontalTranslation(spread.maximumTranslation * progress * direction);
    const translateY = verticalTranslation(progress * 1.5);
    const liftedTranslateY = verticalTranslation(progress * 1.5 - 2);
    const rotation = (-1.5 + progress * 7.5) * direction;

    return {
      ...frameStyle,
      zIndex: lifted ? count + 10 : count - index,
      transform: lifted
        ? `translate3d(${translateX}%, ${liftedTranslateY}%, 0) rotate(${rotation}deg) scale(1.025)`
        : `translate3d(${translateX}%, ${translateY}%, 0) rotate(${rotation}deg) scale(1)`,
      transformOrigin,
    };
  }

  const offset = Math.min(index, MAX_PREVIEW_ASSETS - 1);
  const availableSpreadRatio = Math.min(1, spread.maximumTranslation / Math.max(defaultPreviewTranslation(count), 1));
  const translateX = horizontalTranslation(offset * 2.4 * availableSpreadRatio * direction);
  const raisedTranslateY = verticalTranslation(offset * -2.8);
  const settledTranslateY = verticalTranslation(offset * -0.8);
  const rotation = offset * 1.1 * availableSpreadRatio * direction;

  return {
    ...frameStyle,
    zIndex: lifted ? count + 10 : count - index,
    transform: lifted
      ? `translate3d(${translateX}%, ${raisedTranslateY}%, 0) rotate(${rotation}deg) scale(1.025)`
      : `translate3d(${translateX}%, ${settledTranslateY}%, 0) rotate(${rotation}deg) scale(${1 - offset * 0.008})`,
    transformOrigin,
  };
}

type CanMoveAlbum = (albumId: string, parentAlbumId: string | null) => boolean;
type MoveAlbum = (albumId: string, parentAlbumId: string | null) => Promise<void>;
type CollectionDragKind = 'MATERIAL' | 'CREATION';

interface CollectionMoveOptions {
  canMoveAlbum?: CanMoveAlbum;
  onMoveAlbum?: MoveAlbum;
  canMoveCreationAlbum?: CanMoveAlbum;
  onMoveCreationAlbum?: MoveAlbum;
}

interface CollectionMoveDrop {
  kind: CollectionDragKind;
  albumId: string;
}

function collectionDragKind(
  album: MaterialAlbumDto,
  busy: boolean,
  canMoveAlbum: CanMoveAlbum | undefined,
  onMoveAlbum: MoveAlbum | undefined,
  canMoveCreationAlbum: CanMoveAlbum | undefined,
  onMoveCreationAlbum: MoveAlbum | undefined,
) {
  if (busy) return null;
  if (album.kind === 'USER' && canMoveAlbum && onMoveAlbum) return 'MATERIAL' as const;
  const movableCreationAlbum = album.systemKey === 'CREATION_GROUP' && Boolean(album.sourceAlbumId);
  const movableCreationSeries = album.systemKey === 'CREATION_SERIES' && Boolean(album.sourceSeriesId);
  if ((movableCreationAlbum || movableCreationSeries) && canMoveCreationAlbum && onMoveCreationAlbum) {
    return 'CREATION' as const;
  }
  return null;
}

function collectionMoveDrop(
  dataTransfer: DataTransfer,
  targetAlbum: MaterialAlbumDto,
  options: CollectionMoveOptions,
): CollectionMoveDrop | null {
  if (
    targetAlbum.systemKey === 'CREATION_GROUP' &&
    options.canMoveCreationAlbum &&
    options.onMoveCreationAlbum &&
    hasCreationCollectionDrag(dataTransfer)
  ) {
    const albumId = readCreationCollectionDrag(dataTransfer);
    if (albumId && options.canMoveCreationAlbum(albumId, targetAlbum.id)) return { kind: 'CREATION', albumId };
  }
  if (targetAlbum.kind !== 'USER' || !options.canMoveAlbum || !options.onMoveAlbum) return null;
  const albumId = readMaterialAlbumDrag(dataTransfer);
  return albumId && options.canMoveAlbum(albumId, targetAlbum.id) ? { kind: 'MATERIAL', albumId } : null;
}

function collectionAcceptsDrop(
  dataTransfer: DataTransfer,
  targetAlbum: MaterialAlbumDto,
  options: CollectionMoveOptions,
  canCollectMaterials: boolean,
  canImportFiles: boolean,
) {
  if (collectionMoveDrop(dataTransfer, targetAlbum, options)) return true;
  if (targetAlbum.kind !== 'USER') return false;
  return (
    (canCollectMaterials && hasMaterialsDrag(dataTransfer)) || (canImportFiles && hasExternalFilesDrag(dataTransfer))
  );
}

function collectionOpenLabel(
  writableMaterialAlbum: boolean,
  creationSeries: boolean,
  materialLabel: string,
  seriesLabel: string,
  creationAlbumLabel: string,
) {
  if (writableMaterialAlbum) return materialLabel;
  return creationSeries ? seriesLabel : creationAlbumLabel;
}

function collectionDragHandleAttributes(kind: CollectionDragKind | null, albumId: string) {
  if (kind === 'MATERIAL') return { 'data-material-album-drag-handle': albumId };
  if (kind === 'CREATION') return { 'data-creation-collection-drag-handle': albumId };
  return {};
}

function CreationCollectionPreview({
  assets,
  creation,
  expanded,
  hoveredIndex,
  containerAspectRatio,
  spread,
  onAssetEnter,
  onAssetInspect,
  onAssetLeave,
}: {
  assets: readonly AssetDto[];
  creation: boolean;
  expanded: boolean;
  hoveredIndex: number | null;
  containerAspectRatio: number;
  spread: PreviewSpread;
  onAssetEnter(index: number): void;
  onAssetInspect(index: number): void;
  onAssetLeave(index: number): void;
}) {
  const visibleAssets = assets.slice(0, MAX_PREVIEW_ASSETS);

  return (
    <span
      data-creation-collection-preview
      data-preview-count={visibleAssets.length}
      data-preview-expanded={expanded ? 'true' : 'false'}
      data-preview-spread-direction={spread.direction}
      className="absolute inset-0 overflow-visible"
      aria-hidden="true"
    >
      {visibleAssets.length ? (
        visibleAssets.map((asset, index) => {
          const thumbnailUrl = mediaThumbnailUrl(asset, PREVIEW_THUMBNAIL_SIZE);
          const backdropUrl = mediaThumbnailUrl(asset, PREVIEW_BACKDROP_THUMBNAIL_SIZE);
          const frame = previewFrameBounds(asset, containerAspectRatio);
          const needsEdgeFill = previewNeedsEdgeFill(asset, frame.aspectRatio);
          return (
            <span
              key={asset.id}
              data-preview-asset-id={asset.id}
              className="absolute bottom-0 left-0 isolate overflow-hidden rounded-xl bg-surface-sunken shadow-overlay transition-transform duration-overlay ease-enter will-change-transform motion-reduce:transition-none"
              data-preview-active={hoveredIndex === index ? 'true' : 'false'}
              data-preview-aspect-ratio={frame.aspectRatio.toFixed(3)}
              data-preview-edge-fill={needsEdgeFill ? 'true' : undefined}
              style={previewFrameStyle(index, visibleAssets.length, expanded, hoveredIndex, spread, frame)}
              onPointerEnter={(event) => {
                if (event.pointerType === 'touch') return;
                onAssetEnter(index);
              }}
              onPointerLeave={() => onAssetLeave(index)}
            >
              {needsEdgeFill && <ImageAmbientBackdrop src={backdropUrl} loading="lazy" />}
              <img
                className="relative z-10 size-full object-contain"
                src={thumbnailUrl}
                srcSet={`${backdropUrl} 1x, ${thumbnailUrl} 2x`}
                alt=""
                loading="lazy"
                decoding="async"
                fetchPriority={index === 0 ? 'auto' : 'low'}
                draggable={false}
              />
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 z-20 h-4/5"
                onPointerEnter={(event) => {
                  if (event.pointerType === 'touch') return;
                  onAssetInspect(index);
                }}
              />
            </span>
          );
        })
      ) : (
        <span className="absolute inset-0 grid place-items-center overflow-hidden rounded-xl border border-dashed bg-surface-sunken text-muted-foreground">
          {creation ? (
            <SquarePenIcon className="size-8 opacity-50" />
          ) : (
            <AlbumGlyphIcon className="size-8 opacity-50" />
          )}
        </span>
      )}
    </span>
  );
}

function collectionLifecycleActions({
  album,
  writable,
  busy,
  archiveLabel,
  deleteLabel,
  onArchive,
  onDelete,
}: {
  album: MaterialAlbumDto;
  writable: boolean;
  busy: boolean;
  archiveLabel: string;
  deleteLabel: string;
  onArchive?(album: MaterialAlbumDto): void;
  onDelete?(album: MaterialAlbumDto): void;
}): ActionMenuAction[] {
  if (!writable) return [];
  const actions: ActionMenuAction[] = [];
  if (onArchive) {
    actions.push({
      id: 'archive-album',
      label: archiveLabel,
      icon: ArchiveIcon,
      separatorBefore: true,
      disabled: busy,
      onSelect: () => onArchive(album),
    });
  }
  if (onDelete) {
    actions.push({
      id: 'delete-album',
      label: deleteLabel,
      icon: Trash2Icon,
      destructive: true,
      disabled: busy,
      onSelect: () => onDelete(album),
    });
  }
  return actions;
}

interface CollectionAlbumCardProps {
  album: MaterialAlbumDto;
  containerAspectRatio: number;
  spread: PreviewSpread;
  detail?: string;
  childAlbumCount?: number;
  busy?: boolean;
  onOpen(albumId: string): void;
  canMoveAlbum?: CanMoveAlbum;
  onMoveAlbum?: MoveAlbum;
  canMoveCreationAlbum?: CanMoveAlbum;
  onMoveCreationAlbum?: MoveAlbum;
  onCollectMaterials?(albumId: string, targets: MaterialSelectionTargetInput[]): Promise<void>;
  onImportFiles?(album: MaterialAlbumDto, files: File[]): void;
  onArchive?(album: MaterialAlbumDto): void;
  onDelete?(album: MaterialAlbumDto): void;
}

export function CollectionAlbumCard({
  album,
  containerAspectRatio,
  spread,
  detail,
  childAlbumCount,
  busy = false,
  onOpen,
  canMoveAlbum,
  onMoveAlbum,
  canMoveCreationAlbum,
  onMoveCreationAlbum,
  onCollectMaterials,
  onImportFiles,
  onArchive,
  onDelete,
}: CollectionAlbumCardProps) {
  const { messages } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [previewPinned, setPreviewPinned] = useState(false);
  const [previewSuppressed, setPreviewSuppressed] = useState(false);
  const [hoveredAssetIndex, setHoveredAssetIndex] = useState<number | null>(null);
  const [previewChromeHidden, setPreviewChromeHidden] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const creation = album.systemKey === 'CREATION_SERIES';
  const writableMaterialAlbum = album.kind === 'USER';
  const albumDragKind = collectionDragKind(
    album,
    busy,
    canMoveAlbum,
    onMoveAlbum,
    canMoveCreationAlbum,
    onMoveCreationAlbum,
  );
  const albumDragEnabled = albumDragKind !== null;
  const canExpand = album.previewAssets.length > 1;
  const previewExpanded =
    canExpand && !previewSuppressed && (hovered || focusWithin || previewPinned || hoveredAssetIndex !== null);
  const chromeHidden = previewChromeHidden && !focusWithin;
  const openLabel = collectionOpenLabel(
    writableMaterialAlbum,
    creation,
    messages.gallery.albums.open,
    messages.creator.album.open,
    messages.creator.album.openAlbum,
  );
  const detailLabel = detail ?? messages.gallery.albums.materials(album.materialCount);
  const previewActionLabel = previewPinned ? messages.gallery.albums.collapse : messages.gallery.albums.expand;
  const togglePreviewPinned = () => {
    if (previewPinned) {
      setPreviewPinned(false);
      setPreviewSuppressed(true);
      return;
    }
    setPreviewSuppressed(false);
    setPreviewPinned(true);
  };
  const actions: ActionMenuAction[] = [
    { id: 'open', label: openLabel, icon: FolderOpenIcon, onSelect: () => onOpen(album.id) },
    ...(canExpand
      ? [
          {
            id: previewPinned ? 'collapse-preview' : 'pin-preview',
            label: previewActionLabel,
            icon: previewPinned ? PinOffIcon : PinIcon,
            onSelect: togglePreviewPinned,
          },
        ]
      : []),
    ...collectionLifecycleActions({
      album,
      writable: writableMaterialAlbum,
      busy,
      archiveLabel: messages.gallery.albums.archive,
      deleteLabel: messages.gallery.albums.delete,
      onArchive,
      onDelete,
    }),
  ];

  const moveOptions = { canMoveAlbum, onMoveAlbum, canMoveCreationAlbum, onMoveCreationAlbum };
  const acceptedMove = (event: DragEvent<HTMLElement>) => collectionMoveDrop(event.dataTransfer, album, moveOptions);
  const acceptsDrop = (event: DragEvent<HTMLElement>) =>
    collectionAcceptsDrop(event.dataTransfer, album, moveOptions, Boolean(onCollectMaterials), Boolean(onImportFiles));

  const card = (
    <article
      data-creation-collection-card={writableMaterialAlbum ? undefined : album.id}
      data-creation-collection-kind={creation ? 'CREATION' : 'ALBUM'}
      data-material-album-card={writableMaterialAlbum ? album.id : undefined}
      data-material-count={album.materialCount}
      data-child-album-count={writableMaterialAlbum ? childAlbumCount : undefined}
      data-stack-expanded={previewExpanded ? 'true' : 'false'}
      data-preview-pinned={previewPinned ? 'true' : 'false'}
      data-preview-suppressed={previewSuppressed ? 'true' : 'false'}
      data-preview-chrome-hidden={chromeHidden ? 'true' : 'false'}
      className={cn(
        'corner-continuous group relative h-full min-w-0 overflow-visible rounded-xl',
        previewExpanded && 'z-40',
        dropActive && 'ring-2 ring-ring',
      )}
      onDragEnter={(event) => {
        if (busy || !acceptsDrop(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropActive(true);
      }}
      onDragOver={(event) => {
        if (busy || !acceptsDrop(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = acceptedMove(event) ? 'move' : 'copy';
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={(event) => {
        if (busy || !acceptsDrop(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropActive(false);
        const move = acceptedMove(event);
        if (move) {
          const request =
            move.kind === 'CREATION'
              ? onMoveCreationAlbum?.(move.albumId, album.id)
              : onMoveAlbum?.(move.albumId, album.id);
          void request?.catch(() => undefined);
          return;
        }
        const targets = onCollectMaterials ? readMaterialsDrag(event.dataTransfer) : [];
        if (targets.length) {
          void onCollectMaterials?.(album.id, targets).catch(() => undefined);
          return;
        }
        if (!hasExternalFilesDrag(event.dataTransfer)) return;
        const files = [...event.dataTransfer.files];
        if (files.length) onImportFiles?.(album, files);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        setHovered(true);
        setPreviewSuppressed(false);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch') {
          setHovered(false);
          setHoveredAssetIndex(null);
          setPreviewChromeHidden(false);
        }
      }}
      onFocusCapture={() => {
        setFocusWithin(true);
        setPreviewSuppressed(false);
        setPreviewChromeHidden(false);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocusWithin(false);
          setHoveredAssetIndex(null);
          setPreviewChromeHidden(false);
        }
      }}
    >
      <button
        type="button"
        data-action={writableMaterialAlbum ? 'material-open-album' : 'material-open-creation-collection'}
        className="relative z-10 block size-full min-w-0 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${openLabel}: ${album.title}`}
        onClick={() => onOpen(album.id)}
      >
        <CreationCollectionPreview
          assets={album.previewAssets}
          creation={creation}
          expanded={previewExpanded}
          hoveredIndex={hoveredAssetIndex}
          containerAspectRatio={containerAspectRatio}
          spread={spread}
          onAssetEnter={(index) => {
            setHovered(true);
            setPreviewSuppressed(false);
            setHoveredAssetIndex(index);
          }}
          onAssetInspect={(index) => {
            setHoveredAssetIndex(index);
            setPreviewChromeHidden(true);
          }}
          onAssetLeave={(index) => {
            setHoveredAssetIndex((current) => (current === index ? null : current));
          }}
        />
        <span
          {...collectionDragHandleAttributes(albumDragKind, album.id)}
          draggable={albumDragEnabled}
          className={cn(
            'absolute inset-x-0 bottom-0 z-20 flex min-h-[20%] min-w-0 flex-col items-start justify-end px-3 py-3 pr-12 text-media-checker-a opacity-100 transition-opacity duration-overlay ease-enter motion-reduce:transition-none',
            albumDragEnabled
              ? 'pointer-events-auto cursor-grab select-none active:cursor-grabbing'
              : 'pointer-events-none',
            chromeHidden && 'pointer-events-none opacity-0 duration-fast ease-exit',
          )}
          onDragStart={(event) => {
            if (!albumDragEnabled) {
              event.preventDefault();
              return;
            }
            event.stopPropagation();
            if (albumDragKind === 'MATERIAL') beginMaterialAlbumDrag(event.dataTransfer, album.id);
            else beginCreationCollectionDrag(event.dataTransfer, album.id);
          }}
          onDragEnd={(event) => {
            event.stopPropagation();
            endMaterialAlbumDrag();
            endCreationCollectionDrag();
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-0 z-0 rounded-b-xl [background:var(--image-overlay-copy-scrim)]"
          />
          <span className="relative z-10 min-w-0 max-w-full">
            <strong className="block truncate text-base font-semibold">{album.title}</strong>
            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs opacity-85">
              <AlbumGlyphIcon className="size-3.5 shrink-0" />
              <span className="truncate">{detailLabel}</span>
            </span>
          </span>
        </span>
      </button>
      <ActionMenuButton
        actions={actions}
        label={`${messages.gallery.albums.moreActions}: ${album.title}`}
        className={cn(
          'absolute right-2 bottom-2 z-30 size-7 bg-transparent text-media-checker-a opacity-85 shadow-none transition-opacity duration-overlay ease-enter hover:bg-media-surround-dark/40 hover:text-media-checker-a hover:opacity-100 active:bg-media-surround-dark/55 focus-visible:bg-media-surround-dark/40 focus-visible:text-media-checker-a focus-visible:opacity-100 data-[state=open]:bg-media-surround-dark/55 data-[state=open]:text-media-checker-a data-[state=open]:opacity-100 motion-reduce:transition-none',
          chromeHidden && 'pointer-events-none opacity-0 duration-fast ease-exit',
        )}
      />
    </article>
  );

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      {contextMenuOpen && (
        <ContextMenuContent>
          <ActionContextMenuItems actions={actions} />
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

export function CreationAlbumGrid({ albums, title, busy, onOpen, canMoveCreationAlbum, onMoveCreationAlbum }: Props) {
  const masonryAlbums = useMemo(
    () =>
      albums.map((album) => ({
        id: album.id,
        aspectRatio: collectionAspectRatio(album.previewAssets[0]),
      })),
    [albums],
  );
  if (!albums.length) return null;

  return (
    <section data-slot="creation-album-grid" className="px-4 pt-4 sm:px-6 sm:pt-6">
      {title && (
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{albums.length}</span>
        </div>
      )}
      <ShortestColumnMasonry
        items={masonryAlbums}
        minColumnWidth={COLLECTION_MIN_COLUMN_WIDTH}
        gap={COLLECTION_GAP}
        renderItem={(item, index, placement, layout) => (
          <CollectionAlbumCard
            album={albums[index]}
            containerAspectRatio={item.aspectRatio}
            spread={previewSpreadForPlacement(
              Math.min(albums[index].previewAssets.length, MAX_PREVIEW_ASSETS),
              placement,
              layout,
            )}
            busy={busy}
            onOpen={onOpen}
            canMoveCreationAlbum={canMoveCreationAlbum}
            onMoveCreationAlbum={onMoveCreationAlbum}
          />
        )}
      />
    </section>
  );
}
