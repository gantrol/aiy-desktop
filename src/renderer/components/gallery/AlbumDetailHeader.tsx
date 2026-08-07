import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  GalleryVerticalEndIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { AlbumEditorDialog, DeleteAlbumDialog } from '@/renderer/components/gallery/AlbumDialogs';
import type { AlbumNavigationLabels } from '@/renderer/components/gallery/AlbumNavigation';

interface Labels extends AlbumNavigationLabels {
  materials?(count: number): string;
  creations?(count: number): string;
  childAlbums?(count: number): string;
  newCreation?: string;
  settings?: string;
}

interface Props {
  album: AlbumDto;
  parent: AlbumDto | null;
  effectivelyArchived?: boolean;
  labels: Labels;
  busy: boolean;
  onRename(album: AlbumDto, title: string): Promise<void>;
  onDelete(album: AlbumDto): Promise<void>;
  onTogglePin(album: AlbumDto): Promise<void>;
  onSetArchived(album: AlbumDto, archived: boolean): Promise<void>;
  onCreateCreation?(): void;
  onSettings?(): void;
}

export function AlbumDetailHeader({
  album,
  parent,
  effectivelyArchived,
  labels,
  busy,
  onRename,
  onDelete,
  onTogglePin,
  onSetArchived,
  onCreateCreation,
  onSettings,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ownArchived = Boolean(album.archivedAt);
  const archived = effectivelyArchived ?? ownArchived;
  const actions: ActionMenuAction[] = [
    ...(onSettings && labels.settings
      ? [{ id: 'settings', label: labels.settings, icon: SettingsIcon, disabled: busy, onSelect: onSettings }]
      : []),
    { id: 'rename', label: labels.rename, icon: PencilIcon, disabled: busy, onSelect: () => setRenaming(true) },
    ...(ownArchived
      ? [
          {
            id: 'archive',
            label: labels.restore,
            icon: ArchiveRestoreIcon,
            disabled: busy,
            onSelect: () => void onSetArchived(album, false),
          } satisfies ActionMenuAction,
        ]
      : archived
        ? []
        : [
            {
              id: 'archive',
              label: labels.archive,
              icon: ArchiveIcon,
              disabled: busy,
              onSelect: () => void onSetArchived(album, true),
            } satisfies ActionMenuAction,
          ]),
    {
      id: 'delete',
      label: labels.delete,
      icon: Trash2Icon,
      destructive: true,
      separatorBefore: true,
      disabled: busy,
      onSelect: () => setDeleting(true),
    },
  ];

  return (
    <>
      <section
        className="flex min-h-24 shrink-0 items-center gap-4 border-b bg-surface px-4 py-4 sm:px-6"
        aria-labelledby="album-detail-title"
      >
        <AlbumCover album={album} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 id="album-detail-title" className="truncate text-xl font-semibold tracking-tight" title={album.title}>
              {album.title}
            </h2>
            {archived && <ArchiveIcon className="size-4 shrink-0 text-muted-foreground" aria-label={labels.archived} />}
          </div>
          {parent && <p className="mt-1 truncate text-xs text-muted-foreground">{labels.belongsTo(parent.title)}</p>}
        </div>
        {onCreateCreation && labels.newCreation && !archived && (
          <Button type="button" size="sm" disabled={busy} onClick={onCreateCreation}>
            <PlusIcon className="size-4" />
            {labels.newCreation}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          aria-pressed={album.pinned}
          onClick={() => void onTogglePin(album)}
        >
          {album.pinned ? <PinOffIcon className="size-4" /> : <PinIcon className="size-4" />}
          {album.pinned ? labels.unpin : labels.pin}
        </Button>
        <ActionMenuButton actions={actions} label={labels.moreActions(album.title)} />
      </section>

      <AlbumEditorDialog
        state={renaming ? { mode: 'rename', album, parent: null } : null}
        labels={labels}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setRenaming(false);
        }}
        onSubmit={async (title) => {
          await onRename(album, title);
          setRenaming(false);
        }}
      />
      <DeleteAlbumDialog
        album={deleting ? album : null}
        labels={labels}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setDeleting(false);
        }}
        onDelete={async () => {
          await onDelete(album);
          setDeleting(false);
        }}
      />
    </>
  );
}

function AlbumCover({ album }: { album: AlbumDto }) {
  const assets = album.previewAssets.slice(0, 4);
  if (assets.length === 0)
    return (
      <span className="grid size-16 shrink-0 place-items-center rounded-xl border bg-muted text-muted-foreground">
        <GalleryVerticalEndIcon className="size-6" />
      </span>
    );
  return (
    <span className="grid size-16 shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-xl border bg-media-surround-light">
      {assets.map((asset, index) => (
        <img
          key={asset.id}
          src={asset.mediaUrl}
          alt=""
          className={cn(
            'size-full object-contain',
            assets.length === 1 && 'col-span-2 row-span-2',
            assets.length === 2 && 'row-span-2',
            assets.length === 3 && index === 0 && 'row-span-2',
          )}
          draggable={false}
        />
      ))}
    </span>
  );
}
