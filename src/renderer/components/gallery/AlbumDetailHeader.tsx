import { ArchiveIcon, PencilIcon, PinIcon, PinOffIcon, PlusIcon, SettingsIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import type { AlbumDto, AssetDto } from '@/shared/contracts';
import { AlbumGlyphIcon } from '@/renderer/icons';
import { cn } from '@/renderer/lib/utils';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { PinContentButton } from '@/renderer/features/desktop-petals/PinContentAction';
import { AlbumEditorDialog } from '@/renderer/components/gallery/AlbumDialogs';
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
  previewAssets?: readonly AssetDto[];
  parent: AlbumDto | null;
  effectivelyArchived?: boolean;
  labels: Labels;
  busy: boolean;
  onRename(album: AlbumDto, title: string): Promise<void>;
  onDelete(album: AlbumDto): Promise<void>;
  onTogglePin(album: AlbumDto): Promise<void>;
  onArchive(album: AlbumDto): Promise<void>;
  onCreateCreation?(): void;
  onSettings?(): void;
  notify(message: string): void;
}

export function AlbumDetailHeader({
  album,
  previewAssets,
  parent,
  effectivelyArchived,
  labels,
  busy,
  onRename,
  onDelete,
  onTogglePin,
  onArchive,
  onCreateCreation,
  onSettings,
  notify,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const archived = effectivelyArchived ?? Boolean(album.archivedAt);
  const actions: ActionMenuAction[] = [
    ...(onSettings && labels.settings
      ? [{ id: 'settings', label: labels.settings, icon: SettingsIcon, disabled: busy, onSelect: onSettings }]
      : []),
    { id: 'rename', label: labels.rename, icon: PencilIcon, disabled: busy, onSelect: () => setRenaming(true) },
    ...(!archived
      ? [
          {
            id: 'archive',
            label: labels.archive,
            icon: ArchiveIcon,
            separatorBefore: true,
            disabled: busy,
            onSelect: () => void onArchive(album),
          } satisfies ActionMenuAction,
        ]
      : []),
    {
      id: 'delete',
      label: labels.delete,
      icon: Trash2Icon,
      destructive: true,
      disabled: busy,
      onSelect: () => void onDelete(album),
    },
  ];

  return (
    <>
      <section
        className="flex min-h-24 shrink-0 items-center gap-4 border-b bg-surface px-4 py-4 sm:px-6"
        aria-labelledby="album-detail-title"
      >
        <AlbumCover assets={previewAssets ?? album.previewAssets} />
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
        <PinContentButton
          source={{ kind: 'ALBUM', id: album.id }}
          disabled={busy || archived}
          notify={notify}
          iconOnly
        />
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
    </>
  );
}

function AlbumCover({ assets: allAssets }: { assets: readonly AssetDto[] }) {
  const assets = allAssets.slice(0, 4);
  if (assets.length === 0)
    return (
      <span className="grid size-16 shrink-0 place-items-center rounded-xl border bg-muted text-muted-foreground">
        <AlbumGlyphIcon className="size-6" />
      </span>
    );
  return (
    <span className="grid size-16 shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-xl border bg-border">
      {assets.map((asset, index) => {
        const thumbnailUrl = mediaThumbnailUrl(asset, 96);
        return (
          <span
            key={asset.id}
            className={cn(
              'relative isolate overflow-hidden bg-surface-sunken',
              assets.length === 1 && 'col-span-2 row-span-2',
              assets.length === 2 && 'row-span-2',
              assets.length === 3 && index === 0 && 'row-span-2',
            )}
          >
            <ImageAmbientBackdrop src={thumbnailUrl} loading="lazy" />
            <img
              src={thumbnailUrl}
              alt=""
              className="relative z-10 size-full object-contain"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          </span>
        );
      })}
    </span>
  );
}
