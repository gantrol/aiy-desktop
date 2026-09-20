import { ArchiveIcon, FolderOpenIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState, type DragEvent, type RefObject } from 'react';
import type { MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import {
  hasCreationCollectionDrag,
  hasExternalFilesDrag,
  hasMaterialsDrag,
  readCreationCollectionDrag,
  readMaterialAlbumDrag,
  readMaterialsDrag,
} from '@/renderer/components/albums/albumDrag';
import { CollectionAlbumTile } from '@/renderer/components/gallery/CollectionAlbumTile';
import { CollectionMasonry, collectionCoverRatio } from '@/renderer/components/gallery/CollectionMasonry';
import { useMaterialAlbumMoveActions } from '@/renderer/components/gallery/MaterialAlbumMoveProvider';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  albums: readonly MaterialAlbumDto[];
  title?: string;
  viewportRef?: RefObject<HTMLElement | null>;
  className?: string;
  busy?: boolean;
  onOpen(albumId: string): void;
  canMoveCreationAlbum?: CanMoveAlbum;
  onMoveCreationAlbum?: MoveAlbum;
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
  const [dropActive, setDropActive] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const creation = album.systemKey === 'CREATION_SERIES';
  const writableMaterialAlbum = album.kind === 'USER';
  const moveActions = useMaterialAlbumMoveActions(album, busy);
  const albumDragKind = collectionDragKind(
    album,
    busy,
    canMoveAlbum,
    onMoveAlbum,
    canMoveCreationAlbum,
    onMoveCreationAlbum,
  );
  const openLabel = collectionOpenLabel(
    writableMaterialAlbum,
    creation,
    messages.gallery.albums.open,
    messages.creator.album.open,
    messages.creator.album.openAlbum,
  );
  const detailLabel = detail ?? messages.gallery.albums.materials(album.materialCount);
  const actions: ActionMenuAction[] = [
    { id: 'open', label: openLabel, icon: FolderOpenIcon, onSelect: () => onOpen(album.id) },
    ...moveActions,
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
      className={cn('group relative h-full min-w-0 rounded-md', dropActive && 'ring-2 ring-ring')}
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
    >
      <CollectionAlbumTile
        album={album}
        openLabel={openLabel}
        detailLabel={detailLabel}
        dragKind={albumDragKind}
        onOpen={onOpen}
      />
      <ActionMenuButton
        actions={actions}
        label={`${messages.gallery.albums.moreActions}: ${album.title}`}
        className="absolute right-0 bottom-3 z-10 size-7 rounded-sm text-muted-foreground shadow-none"
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

export function CreationAlbumGrid({
  albums,
  title,
  busy,
  onOpen,
  canMoveCreationAlbum,
  onMoveCreationAlbum,
  viewportRef,
  className,
}: Props) {
  const masonryAlbums = useMemo(
    () => albums.map((album) => ({ id: album.id, aspectRatio: collectionCoverRatio(album.previewAssets[0]) })),
    [albums],
  );
  if (!albums.length) return null;

  return (
    <section data-slot="creation-album-grid" className={cn('px-4 pt-4 sm:px-6 sm:pt-6', className)}>
      {title && (
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{albums.length}</span>
        </div>
      )}
      <CollectionMasonry
        items={masonryAlbums}
        viewportRef={viewportRef}
        renderItem={(_item, index) => (
          <CollectionAlbumCard
            album={albums[index]}
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
